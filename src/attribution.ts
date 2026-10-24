// Viewer-owned attribution. Every published plan, the sample, and every missing or
// expired plan advertises planny, so a shared link can bring a reader back to publish
// their own.
//
// The plan footer is the viewer's markup, not the plan's: it is added after the
// sanitiser and the stored blob never contains it. Plan CSS still shares the document,
// so the footer is a best-effort overlay: inline `!important` declarations cover the
// properties a plan could use to restyle, hide or move it, and it sits last with the
// maximum z-index. The guarantee is best-effort: a fixed `body::after` at the same
// z-index still paints over it, and a targeted rule such as
// `html body footer[data-planny-attribution]{display:none!important}`, or any `@layer`
// rule, can hide it because `display` has to stay in the stylesheet for print to win.
// The robust fix would be a parent viewer page with the plan in an iframe, which is out
// of scope here.
//
// Colours and type come from tokens.json and the plan template's token block. The
// footer paints its own opaque background and contrast-safe text, so a light or
// image-backed plan cannot wash it out.

export const PLUR = 'https://use-planny.vercel.app';

// Every link that points at planny or away from it carries a `ref` so inbound visits can be
// told apart by surface: a visit to `/?ref=plan` came from a published plan's footer, a
// `?ref=site` visit came from the product site. Analytics reads the first page's URL, so
// the parameter survives the click without a redirect or a cookie.
export function withRef(url: string, ref: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`;
}

const LINE = '#262626'; // tokens.json: --line
const BAND = '#000000'; // plan template: --paper
const TEXT = '#d4d4d4'; // 14.2:1 on the band, above the 4.5:1 floor at 11px
const TEXT_STRONG = '#ffffff';
const ACCENT = '#3291FF'; // tokens.json: --accent
// Single quotes keep these font stacks safe inside a double-quoted style attribute.
const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function important(declarations: readonly string[]): string {
  return declarations.map((rule) => `${rule}!important`).join(';');
}

// Plan pages. Inline !important declarations keep the footer visible and un-themed
// whatever the plan's stylesheet does; the style block adds display, hover, focus and
// print. display stays out of the inline set so the print rule can win.
const FOOTER_STYLE = important([
  'box-sizing:border-box',
  'width:100%',
  'max-width:1240px',
  'margin:0 auto',
  'border:0',
  `border-top:1px solid ${LINE}`,
  'border-radius:0',
  `background:${BAND}`,
  'background-image:none',
  `color:${TEXT}`,
  `font-family:${SANS}`,
  'font-size:12px',
  'line-height:1.4',
  'text-align:left',
  'letter-spacing:normal',
  'text-transform:none',
  'text-indent:0',
  'visibility:visible',
  'opacity:1',
  'filter:none',
  'transform:none',
  'translate:none',
  'rotate:none',
  'scale:none',
  'zoom:1',
  'clip:auto',
  'clip-path:none',
  'content-visibility:visible',
  'mask:none',
  '-webkit-mask:none',
  'mix-blend-mode:normal',
  'position:relative',
  'top:auto',
  'right:auto',
  'bottom:auto',
  'left:auto',
  'z-index:2147483647',
  'isolation:isolate',
  'float:none',
  'clear:both',
  'height:auto',
  'min-height:0',
  'max-height:none',
  'overflow:visible',
  'direction:ltr',
  'writing-mode:horizontal-tb',
  'white-space:normal',
  'word-spacing:normal',
  'text-shadow:none',
  'pointer-events:auto',
]);

const FOOTER_LINK_STYLE = important([
  'display:inline-block',
  'box-sizing:border-box',
  `color:${TEXT}`,
  `font-family:${MONO}`,
  'font-size:11px',
  'line-height:1.3',
  'letter-spacing:.14em',
  'text-transform:uppercase',
  'text-decoration:none',
  'text-indent:0',
  'border:0',
  `border-bottom:1px solid ${LINE}`,
  'border-radius:0',
  'padding:0 0 2px',
  'background:transparent',
  'visibility:visible',
  'opacity:1',
  'filter:none',
  'transform:none',
  'translate:none',
  'rotate:none',
  'scale:none',
  'zoom:1',
  'clip:auto',
  'clip-path:none',
  'content-visibility:visible',
  'mask:none',
  '-webkit-mask:none',
  'mix-blend-mode:normal',
  'position:static',
  'writing-mode:horizontal-tb',
  'white-space:nowrap',
  '-webkit-text-fill-color:currentColor',
  'pointer-events:auto',
]);

// `html body` keeps the display rules above any plain plan selector; the print rule
// repeats the selector so it wins over the screen rule on source order.
const FOOTER_SELECTOR = 'html body [data-planny-attribution]';
const FOOTER_CSS = '<style data-planny-attribution-style>'
  + `${FOOTER_SELECTOR}{display:block!important;padding:20px clamp(16px, 4vw, 52px) 32px!important}`
  + `[data-planny-attribution] a:hover{color:${TEXT_STRONG}!important;border-bottom-color:${LINE}!important}`
  + `[data-planny-attribution] a:focus-visible{outline:2px solid ${ACCENT};outline-offset:3px}`
  + '@media (max-width:420px){'
  + `${FOOTER_SELECTOR}{padding-left:16px!important;padding-right:16px!important}`
  + '}'
  + `@media print{${FOOTER_SELECTOR}{display:none!important}}`
  + '</style>';

export function planFooter(ref = 'plan'): string {
  return `${FOOTER_CSS}<footer data-planny-attribution style="${FOOTER_STYLE}">`
    + `<a href="${withRef(PLUR, ref)}" rel="noopener" style="${FOOTER_LINK_STYLE}">Made with Planny</a>`
    + '</footer>';
}

// 404 and 410 pages rendered by the server as plain strings (the local build). They are
// site pages, so they keep the site CSP and the site font stack; the line is
// inline-styled to fit that layout without a stylesheet change.
const INVITE_STYLE = 'margin:28px 0 0;font-family:' + SANS
  + `;font-size:14px;line-height:1.5;color:${TEXT}`;
const INVITE_LINK_STYLE = `color:${TEXT_STRONG};text-decoration:underline;text-underline-offset:2px`;

export function publishInvite(ref = 'invite'): string {
  return `<p data-planny-invite style="${INVITE_STYLE}">Have a plan of your own? `
    + `<a href="${withRef(PLUR, ref)}" rel="noopener" style="${INVITE_LINK_STYLE}">Publish it with Planny</a>.</p>`;
}

function insertBefore(html: string, marker: string, snippet: string): string {
  const at = html.lastIndexOf(marker);
  return at === -1 ? `${html}\n${snippet}` : `${html.slice(0, at)}${snippet}\n${html.slice(at)}`;
}

export function withPlanAttribution(html: string, enabled: boolean, ref = 'plan'): string {
  return enabled ? insertBefore(html, '</body>', planFooter(ref)) : html;
}

// The local string pages carry their own <main>, so the invite can go inside it.
export function withPublishInvite(html: string, enabled: boolean, ref = 'invite'): string {
  return enabled ? insertBefore(html, '</main>', publishInvite(ref)) : html;
}

// The built React pages render into #root, so a server-side insertion lands outside the
// layout. Only the built plan 404/410 responses carry the invite marker, so the generic
// 404, the 429 page and every other built page stay free of the line.
export function withInviteFlag(html: string, enabled: boolean): string {
  const tag = /<html\b/i.exec(html);
  if (!tag) return html;
  const end = html.indexOf('>', tag.index);
  if (end === -1) return html;
  const value = enabled ? 'on' : 'off';
  return `${html.slice(0, end)} data-planny-invite="${value}"${html.slice(end)}`;
}
