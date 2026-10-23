import { parse, serialize } from 'parse5';
import postcss from 'postcss';

interface Attribute {
  name: string;
  value: string;
  prefix?: string;
  namespace?: string;
}

interface Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Attribute[];
  childNodes: Node[];
  parentNode?: Node;
  value?: string;
}

interface Document {
  nodeName: '#document';
  childNodes: Node[];
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DEPTH = 200;
// parse5 spends super-linear time in the number of attributes it keeps, and any one
// start tag can carry as many attributes as the 4 MiB cap allows. The scan bounds both
// counts before the parser runs: 2,048 per tag, 20,000 document-wide.
export const MAX_ATTRIBUTES_PER_TAG = 2048;
export const MAX_ATTRIBUTES_TOTAL = 20_000;

export class SanitizeTooManyAttributesError extends Error {
  readonly code = 'too_many_attributes';

  constructor() {
    super('plan uses too many attributes');
  }
}

const isSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
const isAsciiAlpha = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

// Comments follow the tokenizer's own states, so a markup-looking run can never hide the
// way this scan ends. `<!-->` and `<!--->` are abrupt closings; `-->` and `--!>` close
// normally; anything else runs to the end of the input, exactly like the parser.
function commentEnd(html: string, at: number): number {
  if (html[at] === '>' || (html[at] === '-' && html[at + 1] === '>')) {
    return html[at] === '>' ? at + 1 : at + 2;
  }
  for (let i = at; i < html.length; i += 1) {
    if (html[i] !== '-') continue;
    if (html[i + 1] !== '-') continue;
    if (html[i + 2] === '>') return i + 3;
    if (html[i + 2] === '!' && html[i + 3] === '>') return i + 4;
  }
  return html.length;
}

const TAG_NAME = 0;
const SELF_CLOSING = 1;
const BEFORE_ATTR = 2;
const ATTR_NAME = 3;
const BEFORE_VALUE = 4;
const VALUE_QUOTED = 5;
const VALUE_UNQUOTED = 6;
const AFTER_QUOTED = 7;

// One linear pass that mirrors the tag machinery of the tokenizer state by state: tag
// name, self-closing, before-attribute-name, attribute name, quoted and unquoted values,
// and the after-value state where a name can follow a closing quote without whitespace.
// Entering an attribute name is the only thing that counts, so every attribute the real
// parse can mint is counted, whatever separator the attack omits — including the ones on
// end tags, which parse5 tokenizes (and then drops at the tree level) at the same cost.
// Content is never skipped as raw text: a `<style>` inside `<svg>` parses as markup, so
// its text is scanned too. Entities carry no separators. Counts can only overshoot (a
// quote shaped like a name pulls the matcher along), never undershoot.
//
// Returns the index just after the tag's `>` (or the end of the input) and the number of
// attribute entries inside the tag.
function walkTag(html: string, at: number, i: number): { end: number; count: number } {
  let state = TAG_NAME;
  let quote = '';
  let count = 0;
  while (i < at) {
    const code = html.charCodeAt(i);
    if (code === 62 /* > */) {
      return { end: i + 1, count };
    }
    const space = isSpace(code);
    if (state === TAG_NAME) {
      if (space) state = BEFORE_ATTR;
      else if (code === 47) state = SELF_CLOSING;
      i += 1;
      continue;
    }
    if (state === SELF_CLOSING) {
      // the tokenizer reconsumes the character in the before-attribute-name state
      state = BEFORE_ATTR;
      continue;
    }
    if (state === BEFORE_ATTR) {
      if (space) {
        i += 1;
        continue;
      }
      if (code === 47) {
        state = SELF_CLOSING;
        i += 1;
        continue;
      }
      state = ATTR_NAME;
      count += 1; // entering an attribute name, with `=` as the one odd legal opener
      if (count > MAX_ATTRIBUTES_PER_TAG) throw new SanitizeTooManyAttributesError();
      continue; // reconsume this character in the name state
    }
    if (state === ATTR_NAME) {
      if (space) {
        state = BEFORE_ATTR;
        i += 1;
        continue;
      }
      if (code === 47) {
        state = BEFORE_ATTR;
        continue; // the slash is reconsumed, where it may close the tag
      }
      if (code === 61 /* = */) {
        state = BEFORE_VALUE;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === BEFORE_VALUE) {
      if (space) {
        i += 1;
        continue;
      }
      if (code === 34 || code === 39) {
        quote = String.fromCharCode(code);
        state = VALUE_QUOTED;
        i += 1; // consume the opening quote; the closing one ends the state
        continue;
      }
      state = VALUE_UNQUOTED; // `>` ends the tag from the check above
      continue;
    }
    if (state === VALUE_QUOTED) {
      if (code === quote.charCodeAt(0)) {
        quote = '';
        state = AFTER_QUOTED;
      }
      i += 1;
      continue;
    }
    if (state === VALUE_UNQUOTED) {
      // whitespace ends the value; `/` and `=` are value characters, per spec
      if (space) state = BEFORE_ATTR;
      i += 1;
      continue;
    }
    // AFTER_QUOTED: whitespace or a slash decide, anything else is another attribute
    if (space) {
      state = BEFORE_ATTR;
      i += 1;
      continue;
    }
    if (code === 47) {
      state = SELF_CLOSING;
      i += 1;
      continue;
    }
    state = ATTR_NAME;
    count += 1;
    if (count > MAX_ATTRIBUTES_PER_TAG) throw new SanitizeTooManyAttributesError();
  }
  return { end: at, count };
}

function guardAttributes(html: string): void {
  let total = 0;
  const at = html.length;
  let i = 0;
  while (i < at) {
    if (html.charCodeAt(i) !== 60 /* < */) {
      i += 1;
      continue;
    }
    const open = html.charCodeAt(i + 1);
    if (open === 33 /* ! */) {
      if (html.startsWith('<!--', i)) {
        i = commentEnd(html, i + 4);
      } else {
        // doctype, CDATA and the rest are bogus comments that end at the first `>`
        const cut = html.indexOf('>', i + 2);
        i = cut === -1 ? at : cut + 1;
      }
      continue;
    }
    if (open === 63 /* ? */) {
      // processing-instruction state is a bogus comment that ends at the first `>`
      const cut = html.indexOf('>', i + 2);
      i = cut === -1 ? at : cut + 1;
      continue;
    }
    if (open === 47 /* / */) {
      if (isAsciiAlpha(html.charCodeAt(i + 2))) {
        // an end tag carries attributes that parse5 tokenizes before dropping them,
        // so they cost real time and are counted like start-tag attributes
        const walked = walkTag(html, at, i + 3);
        i = walked.end;
        total += walked.count;
      } else {
        // `</>` and `</3` are bogus comments that end at the first `>`
        const cut = html.indexOf('>', i + 2);
        i = cut === -1 ? at : cut + 1;
      }
    } else if (isAsciiAlpha(open)) {
      const walked = walkTag(html, at, i + 2);
      i = walked.end;
      total += walked.count;
    } else {
      // `<` followed by anything but a name character is text
      i += 1;
    }
    if (total > MAX_ATTRIBUTES_TOTAL) throw new SanitizeTooManyAttributesError();
  }
}

const ALLOWED_HTML = new Set<string>([
  'html', 'head', 'body', 'title', 'meta', 'style',
  'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'span', 'p', 'br', 'hr', 'wbr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption', 'blockquote', 'q', 'cite', 'pre', 'code', 'kbd', 'samp', 'var',
  'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'mark', 'del', 'ins', 'abbr', 'time', 'address',
  'details', 'summary', 'img',
]);

const REMOVED_HTML = new Set<string>([
  'script', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'noframes', 'object', 'embed', 'applet',
  'param', 'base', 'link', 'form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist',
  'output', 'dialog', 'video', 'audio', 'source', 'track', 'picture', 'canvas', 'map', 'area', 'slot',
  'portal', 'fencedframe', 'xmp', 'plaintext', 'listing',
]);

const ALLOWED_SVG = new Set<string>([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'style',
]);

const GLOBAL_ATTRS = new Set<string>(['class', 'id', 'title', 'lang', 'dir', 'role', 'style', 'width', 'height']);

const SVG_ATTRS = new Set<string>([
  'viewbox', 'preserveaspectratio', 'xmlns', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'fx', 'fy', 'pathlength',
]);

const ELEMENT_ATTRS: ReadonlyMap<string, readonly string[]> = new Map([
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

export class SanitizeTooDeepError extends Error {
  readonly code = 'too_deep';

  constructor() {
    super('plan nests elements too deeply');
  }
}

export interface SanitizeResult {
  readonly html: string;
  readonly removed: Record<string, number>;
}

interface Walk {
  removed: Map<string, number>;
  depth: number;
}

export function sanitize(input: string): SanitizeResult {
  guardAttributes(input);
  const document = parse(input) as unknown as Document;
  const walk: Walk = { removed: new Map<string, number>(), depth: 0 };
  document.childNodes = cleanList(walk, document.childNodes);
  adopt(document as unknown as Node);
  ensureBody(document);
  return {
    html: `<!DOCTYPE html>\n${serialize(document as unknown as import('parse5').DefaultTreeAdapterMap['document'])}`,
    removed: Object.fromEntries(walk.removed),
  };
}

function note(walk: Walk, label: string): void {
  walk.removed.set(label, (walk.removed.get(label) ?? 0) + 1);
}

function cleanList(walk: Walk, nodes: Node[]): Node[] {
  walk.depth += 1;
  if (walk.depth > MAX_DEPTH) throw new SanitizeTooDeepError();
  try {
    return nodes.flatMap((node) => cleanNode(walk, node));
  } finally {
    walk.depth -= 1;
  }
}

function cleanNode(walk: Walk, node: Node): Node[] {
  if (node.nodeName === '#text') return [node];
  if (!node.tagName) return [];
  const tag = node.tagName.toLowerCase();
  if (node.namespaceURI === HTML_NS) {
    if (REMOVED_HTML.has(tag)) {
      note(walk, `<${tag}>`);
      return [];
    }
    if (!ALLOWED_HTML.has(tag)) {
      note(walk, tag === 'a' ? 'link <a>' : `<${tag}>`);
      return cleanList(walk, node.childNodes);
    }
    return keep(walk, node, tag, false);
  }
  if (node.namespaceURI === SVG_NS) {
    if (tag === 'a') {
      note(walk, 'link <a>');
      return cleanList(walk, node.childNodes);
    }
    if (!ALLOWED_SVG.has(tag)) {
      note(walk, `<svg ${tag}>`);
      return [];
    }
    return keep(walk, node, tag, true);
  }
  note(walk, `<${tag}>`);
  return [];
}

function keep(walk: Walk, node: Node, tag: string, isSvg: boolean): Node[] {
  if (!isSvg && tag === 'meta' && !metaAllowed(node)) {
    note(walk, metaLabel(node));
    return [];
  }
  node.attrs = cleanAttrs(walk, node, tag, isSvg);
  if (!isSvg && tag === 'img' && !(node.attrs ?? []).some((attr) => attr.name === 'src')) {
    note(walk, '<img> without an embedded image');
    return [];
  }
  if (tag === 'style') {
    const css = node.childNodes.map((child) => (child.nodeName === '#text' ? child.value ?? '' : '')).join('');
    const reason = checkCss(css);
    if (reason) {
      note(walk, `<style>: ${reason}`);
      return [];
    }
    node.childNodes = css ? [textNode(css, node)] : [];
    return [node];
  }
  node.childNodes = cleanList(walk, node.childNodes);
  adopt(node);
  return [node];
}

function cleanAttrs(walk: Walk, node: Node, tag: string, isSvg: boolean): Attribute[] {
  const kept: Attribute[] = [];
  for (const attr of node.attrs ?? []) {
    const name = (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name).toLowerCase();
    if (name.startsWith('on')) {
      note(walk, `event handler ${name}`);
      continue;
    }
    if (!attributeAllowed(name, tag, isSvg)) {
      note(walk, `attribute ${name}`);
      continue;
    }
    if (name === 'src') {
      if (DATA_IMAGE.test(attr.value.trim())) kept.push(attr);
      else note(walk, 'image src that is not an embedded image');
      continue;
    }
    const reason = name === 'style' ? checkCss(attr.value) : checkValue(attr.value);
    if (reason) {
      note(walk, `${name} attribute: ${reason}`);
      continue;
    }
    kept.push(attr);
  }
  return kept;
}

export function checkCss(css: string): string | null {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return 'invalid CSS';
  }
  let reason: string | null = null;
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'import') reason = 'unsafe CSS';
    else if (name === 'font-face') reason = 'URL font';
    else if (!['media', 'supports', 'keyframes', '-webkit-keyframes', 'charset', 'layer'].includes(name)) {
      reason = `unsupported @${name}`;
    }
  });
  root.walkDecls((decl) => {
    if (reason) return;
    const value = decl.value.toLowerCase();
    if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/.test(value)) reason = 'unsafe CSS';
    const urls = [...value.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/g)];
    for (const match of urls) {
      const target = (match[2] ?? '').trim();
      if (!target.startsWith('#') && !DATA_IMAGE_PROBE.test(target)) reason = 'external URL';
    }
  });
  return reason;
}

function checkValue(value: string): string | null {
  const probe = probeOf(value);
  // Browsers drop ASCII tabs, newlines and control characters from a URL scheme, so
  // "jav\tascript:" runs as javascript:. Compare with all of them removed.
  const compact = probe.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (/javascript:|vbscript:/.test(compact)) return 'script URL';
  return urlsAreFragments(probe) ? null : 'external URL';
}

function urlsAreFragments(probe: string): boolean {
  const calls = (probe.match(/url\s*\(/g) ?? []).length;
  const args = [...probe.matchAll(/url\s*\(\s*(["']?)([^"')]*)\1\s*\)/g)];
  return args.length === calls && args.every((match) => {
    const target = (match[2] ?? '').trim();
    return target.startsWith('#') || DATA_IMAGE_PROBE.test(target);
  });
}

function probeOf(text: string): string {
  return decodeCssEscapes(text).toLowerCase();
}

function decodeCssEscapes(text: string): string {
  return text
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_match, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)))
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\[\r\n\f]/g, '');
}

function attributeAllowed(name: string, tag: string, isSvg: boolean): boolean {
  if (name.startsWith('aria-')) return true;
  if (GLOBAL_ATTRS.has(name)) return true;
  if (isSvg) return SVG_ATTRS.has(name);
  return (ELEMENT_ATTRS.get(tag) ?? []).includes(name);
}

function metaAttrs(node: Node): Map<string, string> {
  return new Map((node.attrs ?? []).map((attr) => [attr.name.toLowerCase(), attr.value]));
}

function metaAllowed(node: Node): boolean {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return false;
  if (attrs.has('charset')) return true;
  return ['viewport', 'description', 'color-scheme'].includes((attrs.get('name') ?? '').toLowerCase())
    && attrs.has('content');
}

function metaLabel(node: Node): string {
  const attrs = metaAttrs(node);
  if (attrs.has('http-equiv')) return `meta http-equiv=${(attrs.get('http-equiv') ?? '').toLowerCase()}`;
  if (attrs.has('name')) return `meta name=${(attrs.get('name') ?? '').toLowerCase()}`;
  return '<meta>';
}

function textNode(value: string, parent: Node): Node {
  return { nodeName: '#text', value, childNodes: [], parentNode: parent };
}

function adopt(node: Node): void {
  for (const child of node.childNodes) child.parentNode = node;
}

// A document that came in as a frameset has no body. Add an empty one so a second pass leaves it alone.
function ensureBody(document: Document): void {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  if (!html) return;
  if (html.childNodes.some((node) => node.tagName === 'body')) return;
  html.childNodes.push({
    nodeName: 'body',
    tagName: 'body',
    namespaceURI: HTML_NS,
    attrs: [],
    childNodes: [],
    parentNode: html,
  });
}

