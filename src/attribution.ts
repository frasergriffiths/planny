// Viewer-owned attribution. Every published plan and every missing or expired plan
// advertises planny, so a shared link can bring a reader back to publish their own.
//
// The plan footer is the viewer's markup, not the plan's: it is added after the
// sanitiser and the stored blob never contains it. Plan CSS still shares the document,
// so the footer carries inline `!important` declarations for every property a plan
// could use to restyle, hide or cover it (inline important beats any author rule, and a
// later element with the maximum z-index paints above a plan overlay).
//
// Colours and type come from tokens.json and the plan template's token block.

export const PLUR = 'https://use-planny.vercel.app';

const LINE = '#262626'; // tokens.json: --line
const LINE_STRONG = '#3f3f3f'; // plan template: --line-strong
const INK = '#f5f5f5'; // plan template: --ink
const MUTED = '#a1a1a1'; // plan template: --muted
const ACCENT = '#3291FF'; // tokens.json: --accent
// Single quotes keep these font stacks safe inside a double-quoted style attribute.
const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function important(declarations: readonly string[]): string {
  return declarations.map((rule) => `${rule}!important`).join(';');
}

// Plan pages. Inline !important declarations keep the footer visible and un-themed
// whatever the plan's stylesheet does; the style block adds hover, focus and print.
const FOOTER_STYLE = important([
  // display stays out of the inline set: an inline !important declaration outranks
  // the print rule, and the footer must be invisible in print.
  'box-sizing:border-box',
  'width:100%',
  'max-width:1240px',
  'margin:0 auto',
  'padding:20px clamp(20px, 4vw, 52px) 32px',
  'border:0',
  `border-top:1px solid ${LINE}`,
  'border-radius:0',
  'background:transparent',
  `color:${MUTED}`,
  `font-family:${SANS}`,
  'font-size:12px',
  'line-height:1.4',
  'text-align:left',
  'letter-spacing:normal',
  'text-transform:none',
  'visibility:visible',
  'opacity:1',
  'filter:none',
  'transform:none',
  'position:relative',
  'z-index:2147483647',
  'isolation:isolate',
  'float:none',
  'clear:both',
  'height:auto',
  'min-height:0',
  'max-height:none',
  'overflow:visible',
  'direction:ltr',
  'white-space:normal',
  'word-spacing:normal',
  'text-shadow:none',
  'pointer-events:auto',
]);

const FOOTER_LINK_STYLE = important([
  'display:inline-block',
  'box-sizing:border-box',
  `color:${MUTED}`,
  `font-family:${MONO}`,
  'font-size:11px',
  'line-height:1.3',
  'letter-spacing:.14em',
  'text-transform:uppercase',
  'text-decoration:none',
  `border:0`,
  `border-bottom:1px solid ${LINE}`,
  'border-radius:0',
  'padding:0 0 2px',
  'background:transparent',
  'visibility:visible',
  'opacity:1',
]);

// `html body` keeps the display rules above any plain plan selector; the print rule
// repeats the selector so it wins over the screen rule on source order.
const FOOTER_SELECTOR = 'html body [data-planny-attribution]';
const FOOTER_CSS = '<style data-planny-attribution-style>'
  + `${FOOTER_SELECTOR}{display:block!important}`
  + `[data-planny-attribution] a:hover{color:${INK}!important;border-bottom-color:${LINE_STRONG}!important}`
  + `[data-planny-attribution] a:focus-visible{outline:2px solid ${ACCENT};outline-offset:3px}`
  + `@media print{${FOOTER_SELECTOR}{display:none!important}}`
  + '</style>';

export function planFooter(): string {
  return `${FOOTER_CSS}<footer data-planny-attribution style="${FOOTER_STYLE}">`
    + `<a href="${PLUR}" rel="noopener" style="${FOOTER_LINK_STYLE}">Made with Planny</a>`
    + '</footer>';
}

// 404 and 410 pages. These are site pages, so they keep the site CSP and the site
// font stack; the line is inline-styled so it fits both the local strings and the
// built React pages without a stylesheet change.
const INVITE_STYLE = 'margin:28px 0 0;font-family:' + SANS
  + `;font-size:14px;line-height:1.5;color:${MUTED}`;
const INVITE_LINK_STYLE = `color:${INK};text-decoration:underline;text-underline-offset:2px`;

export function publishInvite(): string {
  return `<p data-planny-invite style="${INVITE_STYLE}">Have a plan of your own? `
    + `<a href="${PLUR}" rel="noopener" style="${INVITE_LINK_STYLE}">Publish it with Planny</a>.</p>`;
}

function insertBefore(html: string, marker: string, snippet: string): string {
  const at = html.lastIndexOf(marker);
  return at === -1 ? `${html}\n${snippet}` : `${html.slice(0, at)}${snippet}\n${html.slice(at)}`;
}

export function withPlanAttribution(html: string, enabled: boolean): string {
  return enabled ? insertBefore(html, '</body>', planFooter()) : html;
}

export function withPublishInvite(html: string, enabled: boolean): string {
  return enabled ? insertBefore(html, '</main>', publishInvite()) : html;
}
