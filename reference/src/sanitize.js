import { parse, parseFragment, serialize } from 'parse5';
import { escapeHtml } from './util.js';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DEPTH = 200;

// HTML elements a plan may use. Any other HTML element is unwrapped, keeping its text.
const ALLOWED_HTML = new Set([
  'html', 'head', 'body', 'title', 'meta', 'style',
  'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr', 'wbr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var',
  'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'abbr', 'time', 'address',
  'details', 'summary', 'img',
]);

// Elements dropped together with everything inside them.
const REMOVED_HTML = new Set([
  'script', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'noframes', 'object', 'embed', 'applet',
  'param', 'base', 'link', 'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist',
  'output', 'dialog', 'video', 'audio', 'source', 'track', 'picture', 'canvas', 'map', 'area', 'slot',
  'portal', 'fencedframe', 'frameset', 'noframes', 'xmp', 'plaintext', 'listing',
]);

const ALLOWED_SVG = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'style',
]);

const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'lang', 'dir', 'role', 'style', 'width', 'height']);

const SVG_ATTRS = new Set([
  'viewbox', 'preserveaspectratio', 'xmlns', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'fx', 'fy',
]);

const ELEMENT_ATTRS = new Map([
  ['img', ['alt', 'src']],
  ['meta', ['charset', 'name', 'content']],
  ['time', ['datetime']],
  ['details', ['open']],
  ['ol', ['start', 'reversed']],
  ['col', ['span']],
  ['colgroup', ['span']],
  ['td', ['colspan', 'rowspan', 'headers', 'abbr']],
  ['th', ['colspan', 'rowspan', 'headers', 'abbr', 'scope']],
]);

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
const DATA_IMAGE_PROBE = /^data:image\/(png|jpeg|gif|webp|avif)[;,]/;
const UNSAFE_CSS = /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|image-set\s*\(|\bimage\s*\(|\bsrc\s*\(|<\/|<!--|-->/;

export function sanitize(input, { localLabel } = {}) {
  const removed = new Map();
  const note = (label) => removed.set(label, (removed.get(label) ?? 0) + 1);
  const document = parse(String(input));

  let depth = 0;
  const cleanList = (nodes) => {
    depth += 1;
    if (depth > MAX_DEPTH) {
      const error = new Error('plan nests elements too deeply');
      error.code = 'too_deep';
      throw error;
    }
    try {
      return nodes.flatMap(cleanNode);
    } finally {
      depth -= 1;
    }
  };

  function cleanNode(node) {
    if (node.nodeName === '#text') return [node];
    if (!node.tagName) return [];
    const tag = node.tagName.toLowerCase();
    if (node.namespaceURI === HTML_NS && tag === 'meta' && !metaAllowed(node)) {
      note(metaLabel(node));
      return [];
    }
    if (node.namespaceURI === HTML_NS) {
      if (REMOVED_HTML.has(tag)) {
        note(`<${tag}>`);
        return [];
      }
      if (!ALLOWED_HTML.has(tag)) {
        note(tag === 'a' ? 'link <a>' : `<${tag}>`);
        return cleanList(node.childNodes);
      }
      return keep(node, tag, false);
    }
    if (node.namespaceURI === SVG_NS) {
      if (tag === 'a') {
        note('link <a>');
        return cleanList(node.childNodes);
      }
      if (!ALLOWED_SVG.has(tag)) {
        note(`<svg ${tag}>`);
        return [];
      }
      return keep(node, tag, true);
    }
    note(`<${tag}>`);
    return [];
  }

  function keep(node, tag, isSvg) {
    if (!isSvg && tag === 'meta' && !metaAllowed(node)) {
      note(metaLabel(node));
      return [];
    }
    node.attrs = cleanAttrs(node, tag, isSvg);
    if (!isSvg && tag === 'img' && !node.attrs.some((attr) => attr.name === 'src')) {
      note('<img> without an embedded image');
      return [];
    }
    if (tag === 'style') {
      const css = node.childNodes.map((child) => (child.nodeName === '#text' ? child.value : '')).join('');
      const reason = checkCss(css);
      if (reason) {
        note(`<style>: ${reason}`);
        return [];
      }
      node.childNodes = css ? [textNode(css, node)] : [];
      return [node];
    }
    node.childNodes = cleanList(node.childNodes);
    adopt(node);
    return [node];
  }

  function cleanAttrs(node, tag, isSvg) {
    const kept = [];
    for (const attr of node.attrs) {
      const name = (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name).toLowerCase();
      if (name.startsWith('on')) {
        note(`event handler ${name}`);
        continue;
      }
      if (!attributeAllowed(name, tag, isSvg)) {
        note(`attribute ${name}`);
        continue;
      }
      if (name === 'src') {
        if (DATA_IMAGE.test(attr.value.trim())) kept.push(attr);
        else note('image src that is not an embedded image');
        continue;
      }
      const reason = name === 'style' ? checkCss(attr.value) : checkValue(attr.value);
      if (reason) {
        note(`${name} attribute: ${reason}`);
        continue;
      }
      kept.push(attr);
    }
    return kept;
  }

  document.childNodes = cleanList(document.childNodes);
  adopt(document);
  ensureBody(document);
  if (localLabel) labelLocal(document, localLabel);
  return { html: `<!DOCTYPE html>\n${serialize(document)}`, removed: Object.fromEntries(removed) };
}

export function checkCss(css) {
  const probe = probeOf(css);
  if (UNSAFE_CSS.test(probe)) return 'unsafe CSS';
  return urlsAreFragments(probe) ? null : 'external URL';
}

function checkValue(value) {
  const probe = probeOf(value);
  if (/javascript:|vbscript:/.test(probe)) return 'script URL';
  return urlsAreFragments(probe) ? null : 'external URL';
}

function urlsAreFragments(probe) {
  const calls = (probe.match(/url\s*\(/g) ?? []).length;
  const args = [...probe.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/g)];
  return args.length === calls && args.every(([, , arg]) => {
    const target = arg.trim();
    return target.startsWith('#') || DATA_IMAGE_PROBE.test(target);
  });
}

function probeOf(text) {
  return decodeCssEscapes(String(text)).toLowerCase();
}

function decodeCssEscapes(text) {
  return text
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)))
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\[\r\n\f]/g, '');
}

function attributeAllowed(name, tag, isSvg) {
  if (name.startsWith('aria-')) return true;
  if (GLOBAL_ATTRS.has(name)) return true;
  if (isSvg) return SVG_ATTRS.has(name);
  return (ELEMENT_ATTRS.get(tag) ?? []).includes(name);
}

function metaAttrs(node) {
  return new Map(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
}

function metaAllowed(node) {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return false;
  if (attrs.has('charset')) return true;
  return ['viewport', 'description', 'color-scheme'].includes((attrs.get('name') ?? '').toLowerCase())
    && attrs.has('content');
}

function metaLabel(node) {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return `meta http-equiv=${attrs.get('http-equiv').toLowerCase()}`;
  if (attrs.has('name')) return `meta name=${attrs.get('name').toLowerCase()}`;
  return '<meta>';
}

function textNode(value, parent) {
  return { nodeName: '#text', value, parentNode: parent };
}

function adopt(node) {
  for (const child of node.childNodes ?? []) child.parentNode = node;
}

// A document that came in as a frameset has no body. Add an empty one so a second pass leaves it alone.
function ensureBody(document) {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  if (!html) return;
  if (html.childNodes.some((node) => node.tagName === 'body')) return;
  html.childNodes.push({
    nodeName: 'body',
    tagName: 'body',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    attrs: [],
    childNodes: [],
    parentNode: html,
  });
}

function labelLocal(document, label) {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  const head = html?.childNodes.find((node) => node.tagName === 'head');
  const body = html?.childNodes.find((node) => node.tagName === 'body');
  if (!head || !body) return;
  const title = head.childNodes.find((node) => node.tagName === 'title');
  const original = title ? title.childNodes.map((node) => node.value ?? '').join('').trim() : '';
  const text = `LOCAL · ${original || label} | planny`;
  if (title) {
    title.childNodes = [textNode(text, title)];
  } else {
    head.childNodes.unshift(...parseFragment(`<title>${escapeHtml(text)}</title>`).childNodes);
  }
  const banner = parseFragment(
    `<div class="planny-local" style="position:fixed;top:0;right:0;z-index:2147483647;max-width:70vw;overflow:hidden;`
    + `text-overflow:ellipsis;white-space:nowrap;margin:0;padding:.3rem .6rem;background:#FFE27A;color:#1B2430;`
    + `font:600 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.04em;border-bottom-left-radius:4px">`
    + `LOCAL · ${escapeHtml(label)}</div>`,
  ).childNodes;
  body.childNodes.unshift(...banner);
  adopt(head);
  adopt(body);
}
