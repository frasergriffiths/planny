import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCss, sanitize } from '../src/sanitize.js';

const LEFTOVERS = [
  /<\/?(script|iframe|frame|frameset|object|embed|base|link|form|input|button|select|textarea|template|noscript|math|a|use|image|animate|set|foreignobject|video|audio|source)\b/i,
  /<meta[^>]*http-equiv/i,
  /<meta[^>]*name\s*=\s*["']?referrer/i,
  /\son[a-z]+\s*=/i,
  /\bhref\s*=/i,
  /\bxlink:/i,
  /\bformaction\b/i,
  /\bsrcset\s*=/i,
  /\bsrcdoc\s*=/i,
  /javascript:/i,
  /@import/i,
  /url\s*\((?!\s*['"]?(#|data:image\/))/i,
  /\bsrc\s*=\s*(?!["']?data:image\/)/i,
  /\bdata-/i,
];

const HOSTILE = [
  '<a href="javascript:alert(1)">x</a>',
  '<a href="https://evil.example">x</a>',
  '<svg><a xlink:href="https://evil.example"><text>x</text></a></svg>',
  '<svg><use href="https://evil.example/x.svg#a"/></svg>',
  '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zy8+#a"/></svg>',
  '<svg><image href="https://evil.example/x.png" width="10" height="10"/></svg>',
  '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>',
  '<svg><rect width="5" height="5" fill="url(https://evil.example/paint.svg#p)"/></svg>',
  '<svg><style>@import url(https://evil.example/x.css);</style><circle r="3"/></svg>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<form action="https://evil.example"><input name="password"><button formaction="https://evil.example">Go</button></form>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<meta name="referrer" content="unsafe-url">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<link rel="prefetch" href="https://evil.example">',
  '<style>@import url(https://evil.example/x.css);</style>',
  '<style>p { background: url(https://evil.example/x.png) }</style>',
  '<style>p { background: u\\72l(https://evil.example/x.png) }</style>',
  '<p style="background:url(\'https://evil.example/x.png\')">x</p>',
  '<p style="width:expression(alert(1))">x</p>',
  '<img src="https://evil.example/x.png" alt="x">',
  '<img src="x" onerror="alert(1)">',
  '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">',
  '<body onload="alert(1)"><div onmouseover="x()">t</div></body>',
  '<details ontoggle="alert(1)" open><summary>s</summary></details>',
  '<table background="https://evil.example/x.png"><tr><td>t</td></tr></table>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<template><script>alert(1)</script></template>',
  '<noscript><p><img src=x onerror=alert(1)></p></noscript>',
  '<svg><style>@import url(https://evil.example/x.css)</style></svg>',
  '<script>alert(1)</script>',
  '<!--<script>alert(1)</script>-->',
  '<title>Hi</title><style></style><script src="https://evil.example/x.js"></script>',
  '<div id="a" role="note" aria-label="ok" data-x="1">x</div>',
  '<style>p{content:"/*"}p{background:url(https://evil.example/x.png)}/**/</style>',
];

test('hostile markup leaves nothing dangerous behind', () => {
  for (const payload of HOSTILE) {
    const { html } = sanitize(payload);
    const found = LEFTOVERS.filter((pattern) => pattern.test(html)).map(String);
    assert.deepEqual(found, [], `${payload} left ${found.join(', ')} in ${html}`);
  }
});

test('very deep nesting is refused, not left to overflow the stack', () => {
  assert.throws(() => sanitize('<div>'.repeat(5000)), (error) => error.code === 'too_deep');
});

test('plan content survives: tables, inline SVG, embedded images, safe CSS', () => {
  const html = '<!doctype html><html><head><title>Plan</title>'
    + '<meta name="viewport" content="width=device-width"><style>.bar{fill:#1B2430}</style></head>'
    + '<body><h1>Q4</h1><table><tr><th scope="col">Item</th><td colspan="2">Value</td></tr></table>'
    + '<svg viewBox="0 0 10 10" width="100" height="100"><rect x="1" y="1" width="8" height="4" '
    + 'fill="#5E6B78" class="bar"/><text x="1" y="9">label</text></svg>'
    + '<img alt="dot" src="data:image/png;base64,iVBORw0KGgo="><time datetime="2026-10-19">today</time>'
    + '<p style="color:#B3261E">Stamp</p></body></html>';
  const result = sanitize(html);
  assert.deepEqual(result.removed, {});
  for (const piece of [
    '<h1>Q4</h1>',
    'viewBox="0 0 10 10"',
    'class="bar"',
    '<text',
    'data:image/png;base64,iVBORw0KGgo=',
    '<time datetime="2026-10-19">',
    'color:#B3261E',
    '<style>',
  ]) {
    assert.ok(result.html.includes(piece), `missing ${piece}`);
  }
});

test('links are unwrapped, so their text stays and the link goes', () => {
  const { html, removed } = sanitize('<p><a href="#x">jump</a></p>');
  assert.ok(html.includes('jump'));
  assert.equal(removed['link <a>'], 1);
});

test('the reply lists what was removed, by name', () => {
  const { removed } = sanitize('<a href="https://evil.example">x</a><script>1</script>'
    + '<p onclick="x()">y</p><meta http-equiv="refresh" content="0">');
  assert.equal(removed['link <a>'], 1);
  assert.equal(removed['<script>'], 1);
  assert.equal(removed['event handler onclick'], 1);
  assert.equal(removed['meta http-equiv=refresh'], 1);
});

test('sanitising a plan twice changes nothing', () => {
  const extra = [
    '<frameset><frame src="https://evil.example"></frameset>',
    '<meta http-equiv="refresh" content="0"><meta name="referrer" content="unsafe-url">',
    '<meta name="viewport"><meta name="description" content="ok">',
  ];
  for (const payload of [...HOSTILE, ...extra]) {
    const once = sanitize(payload).html;
    assert.equal(sanitize(once).html, once, payload);
  }
});

test('local builds label the page and its title', () => {
  const { html } = sanitize('<html><head><title>Q4</title></head><body><p>x</p></body></html>', {
    localLabel: 'Q4 rollout',
  });
  assert.match(html, /<title>LOCAL · Q4 \| planny<\/title>/);
  assert.match(html, /class="planny-local"/);
  assert.match(html, /LOCAL · Q4 rollout/);
});

test('CSS may use fragments and embedded images, and nothing that loads', () => {
  assert.equal(checkCss('p{fill:url(#grad)}'), null);
  assert.equal(checkCss('p{background:url("data:image/png;base64,AAAA")}'), null);
  assert.equal(checkCss('p{background:url(https://evil.example/a.png)}'), 'external URL');
  assert.equal(checkCss('@import "x.css";'), 'unsafe CSS');
  assert.equal(checkCss('p{background:u\\72l(https://evil.example/a.png)}'), 'external URL');
  assert.equal(checkCss('p{x:expression(alert(1))}'), 'unsafe CSS');
});
