import { parse, parseFragment, serialize } from 'parse5';
import { escapeHtml } from './util.js';

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
  'fx', 'fy',
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
const UNSAFE_CSS = /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:|image-set\s*\(|\bimage\s*\(|\bsrc\s*\(|<\/|<!--|-->/;

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

export interface SanitizeOptions {
  readonly mode?: 'local' | 'vercel';
}

interface Walk {
  removed: Map<string, number>;
  depth: number;
}

export function sanitize(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const document = parse(input) as unknown as Document;
  const walk: Walk = { removed: new Map<string, number>(), depth: 0 };
  document.childNodes = cleanList(walk, document.childNodes);
  adopt(document as unknown as Node);
  ensureBody(document);
  if (options.mode) addPlanFooter(document, options.mode);
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
  const probe = probeOf(css);
  if (UNSAFE_CSS.test(probe)) return 'unsafe CSS';
  return urlsAreFragments(probe) ? null : 'external URL';
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
  const args = [...probe.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/g)];
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

// A plan page ends with one line saying where it is hosted. Plain text on the local build,
// a link to the home page on Vercel. The plan CSP allows 'self' for links.
function addPlanFooter(document: Document, mode: 'local' | 'vercel'): void {
  const html = document.childNodes.find((node) => node.tagName === 'html');
  const body = html?.childNodes.find((node) => node.tagName === 'body');
  if (!body) return;
  const text = mode === 'vercel'
    ? '<span>Hosted by <a href="/">planny</a>. The link is the only key.</span>'
    : '<span>Hosted by planny, local build.</span>';
  const footer = parseFragment(
    '<div class="planny-plan-footer" style="margin:2.5rem 0 0;padding-top:1rem;border-top:1px solid rgba(255,255,255,.14);'
    + 'color:#a1a1a1;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">'
    + `${text}</div>`,
  ).childNodes as unknown as Node[];
  body.childNodes.push(...footer);
  adopt(body);
}
