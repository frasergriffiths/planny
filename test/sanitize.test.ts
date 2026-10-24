import { expect, test } from 'bun:test';
import { parse } from 'parse5';
import { MAX_ATTRIBUTES_PER_TAG, MAX_ATTRIBUTES_TOTAL, SanitizeTooDeepError, SanitizeTooManyAttributesError, checkCss, sanitize } from '../src/sanitize.js';

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
  '<svg><image href="https://evil.example/x.png" width="10" height="10"/></svg>',
  '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>',
  '<svg><rect width="5" height="5" fill="url(https://evil.example/paint.svg#p)"/></svg>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<form action="https://evil.example"><input name="password"><button formaction="https://evil.example">Go</button></form>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<meta name="referrer" content="unsafe-url">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<style>@import url(https://evil.example/x.css);</style>',
  '<style>p { background: url(https://evil.example/x.png) }</style>',
  '<style>p{content:"/*"}p{background:url(https://evil.example/x.png)}/**/</style>',
  '<p style="background:u\\72l(https://evil.example/x.png)">x</p>',
  '<img src="https://evil.example/x.png" alt="x">',
  '<img src="x" onerror="alert(1)">',
  '<body onload="alert(1)"><div onmouseover="x()">t</div></body>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<template><script>alert(1)</script></template>',
  '<div id="a" role="note" aria-label="ok" data-x="1">x</div>',
];

function assertClean(html: string): void {
  expect(LEFTOVERS.filter((pattern) => pattern.test(html)).map(String)).toEqual([]);
}

test('hostile markup leaves nothing dangerous behind', () => {
  for (const payload of HOSTILE) assertClean(sanitize(payload).html);
});

test('plan content survives', () => {
  const html = '<html><head><title>Plan</title><meta name="viewport" content="width=device-width">'
    + '<style>.bar{fill:#1B2430}@media (max-width:600px){.bar{fill:#fff}}@supports (display:grid){.g{display:grid}}'
    + '@keyframes grow{from{opacity:0}to{opacity:1}}@media print{.bar{fill:#000}}@media (prefers-reduced-motion:reduce){*{animation:none}}'
    + '@media (min-width:1200px){.wide{width:100%}}</style></head><body><h1>Q4</h1><table><tr><th scope="col">Item</th>'
    + '<td colspan="2">Value</td></tr></table><svg viewBox="0 0 10 10" width="100" height="100">'
    + '<rect x="1" y="1" width="8" height="4" fill="#5E6B78" class="bar"/><text x="1" y="9">label</text></svg>'
    + '<img alt="dot" src="data:image/png;base64,iVBORw0KGgo="><time datetime="2026-10-19">today</time>'
    + '<p style="color:#B3261E">Stamp</p></body></html>';
  const result = sanitize(html);
  expect(result.removed).toEqual({});
  for (const piece of ['<h1>Q4</h1>', 'viewBox="0 0 10 10"', 'class="bar"', 'data:image/png;base64,iVBORw0KGgo=', '<style>']) {
    expect(result.html).toContain(piece);
  }
});

test('a plan is unchanged when sanitised twice', () => {
  const extra = [
    '<frameset><frame src="https://evil.example"></frameset>',
    '<meta http-equiv="refresh" content="0"><meta name="referrer" content="unsafe-url">',
  ];
  for (const payload of [...HOSTILE, ...extra]) {
    const once = sanitize(payload).html;
    expect(sanitize(once).html).toBe(once);
  }
});

test('deep nesting is refused', () => {
  expect(() => sanitize('<div>'.repeat(5000))).toThrow(SanitizeTooDeepError);
});

// The three bypass classes found in the first cut of the guard, inflated past the
// document cap: their hidden attributes are real parse5 tokens, so the guard counts
// them and refuses long before the parser runs. Each shape was accepted at 93a8b2d,
// where the scan stopped early and never saw the hidden attributes.
const hidden = (n: number): string => Array.from({ length: n }, (_, i) => `a${i}=1`).join(' ');

test('the bypass classes are counted wherever they hide', () => {
  const over = hidden(MAX_ATTRIBUTES_TOTAL + 1);
  // bypass 1: a `>` inside a quoted value may not end the scan early
  expect(() => sanitize(`<div a=">"${over}>x`)).toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`</p a=">"${over}>x`)).toThrow(SanitizeTooManyAttributesError);
  // a quoted `>` stays value text, and the tag still ends at its real `>` — and
  // parse5 serializes a `>` in an attribute value unescaped
  expect(sanitize('<div class=">">t</div>').html).toContain('<div class=">">t</div>');
  // bypass 2: a `<!--` inside a raw-text interior is text, never a comment
  for (const el of ['title', 'textarea', 'style', 'script', 'xmp', 'iframe', 'noscript']) {
    expect(() => sanitize(`<${el}><!--</${el}><div${over}>x</div>-->`)).toThrow(SanitizeTooManyAttributesError);
  }
  // bypass 3: a bare `=` name separated from the next by a value mints one entry per
  // pair, in the tokenizer and in this scan alike (`=a=b ` pairs never merge, unlike
  // space-only sequences where the odd `=` becomes the previous attribute's value)
  expect(() => sanitize(`<div ${'=a=b '.repeat(MAX_ATTRIBUTES_PER_TAG + 1)}>x</div>`))
    .toThrow(SanitizeTooManyAttributesError);
});

test('content zones track the tokenizer exactly', () => {
  const over = hidden(MAX_ATTRIBUTES_TOTAL + 1);
  // the script escape dance: `<!--` starts escaped text, `<script>` double-escapes it,
  // `</script>` there only steps back, and the element closes at the real `</script>`
  expect(sanitize('<script>a</script><p class="x">1</p>').html).toContain('<p class="x">1</p>');
  const dance = '<script><!--<script>e</script>--></script><p class="x">1</p>';
  expect(sanitize(dance).html).toContain('<p class="x">1</p>');
  // markup after the dance or after a plain close is counted like any other markup
  expect(() => sanitize(`<script><!--<script></script>--></script><div ${over}>x`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<script><!--y--></script><div ${over}>x`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<title>c</title><div ${over}>x`)).toThrow(SanitizeTooManyAttributesError);
  // svg content is markup: svg `<style>` is not raw text, and a causesExit start tag
  // like `<div>` leaves the foreign context as a plainly-minted html element — parse5
  // mints its attributes in the tree, so the scan counts them like any others
  expect(() => sanitize(`<svg><style><div ${hidden(MAX_ATTRIBUTES_PER_TAG + 1)}></style></svg>`))
    .toThrow(SanitizeTooManyAttributesError);
  // an interior close that fails its terminator check stays raw text
  expect(sanitize('<textarea></textareaX<div a=1></textarea><p class="x">1</p>').html)
    .toContain('<p class="x">1</p>');
  // a fused select/frameset zone never trusts a comment or a raw-text switch
  expect(sanitize('<select><style><foo a=1></style></select><p class="x">1</p>').html)
    .toContain('class="x"');
  expect(sanitize('<body><frameset><style><foo a=1></style></frameset><p class="x">1</p></body>').html)
    .toContain('class="x"');
});

// Fresh under-count classes found in the second review round, inflated past the caps:
// nested foreign contexts, integration points that never empty the context, and
// end-tag attributes the scan walked but used to drop. Each was a 201 at the
// previous head where the attributes parse5 tokenizes were skipped.
test('nested foreign content is counted whatever its depth', () => {
  const over = hidden(MAX_ATTRIBUTES_PER_TAG + 1);
  // nested svg/math: the inner close pops only that context, so a later bomb inside
  // the outer one is still real markup
  expect(() => sanitize(`<svg><svg></svg><style><div ${over}></style></svg>`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<math><math></math><style><div ${over}></style></math>`))
    .toThrow(SanitizeTooManyAttributesError);
  // integration points: parse5 stays inside the context and mints the markup
  expect(() => sanitize(`<svg><foreignObject><div></div></foreignObject><style><div ${over}></style></svg>`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<svg><desc><div></div></desc><style><div ${over}></style></svg>`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<svg><title><div></div></title><style><div ${over}></style></svg>`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<math><mtext><div></div></mtext><style><div ${over}></style></math>`))
    .toThrow(SanitizeTooManyAttributesError);
  // the walk-up pop stays exact: an unclosed child dies with its svg, so a raw-text
  // body after it is skipped by parse5 too — nothing in it becomes an attribute
  expect(sanitize('<svg><foo></svg><style>/*<div a=1 are text>*/</style><p class="x">1</p>').html)
    .toContain('class="x"');
});

test('end tags inside raw-text interiors carry their attribute cost', () => {
  // 100 broken closers, each carrying attributes parse5 tokenizes before dropping:
  // the scan used to walk them and then throw the count away
  expect(() => sanitize(('<title></title ' + hidden(2047) + '>').repeat(100)))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(('<script></script ' + hidden(2000) + '>').repeat(100)))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(('<style></style ' + hidden(2047) + '>').repeat(100)))
    .toThrow(SanitizeTooManyAttributesError);
  // at the boundary it is still accepted: 2048 is within the per-tag budget
  expect(sanitize(`<title>ok</title ${hidden(2048)}>t<p class="x">1</p>`).html)
    .toContain('class="x"');
});

// After a bare attribute name parse5 treats `=` as that attribute's value separator,
// so `a == x0/…/x99/ ` repeated mints one real attribute per x-segment while a scan
// without the after-attribute-name state counts the run as a single `=`-named
// attribute's value. Both sizes were 201 at the previous head (16.2 s at 806 KB).
test('attribute separators after a bare name do not hide attributes', () => {
  // every x-segment after the `=`-run is its own tokenized attribute
  const perName = `<v ${'a == x0/x1/x2/x3/x4/x5/x6/x7/x8/x9/c/d/e/f/g/h/i/j/k/'.repeat(125)}>`;
  expect(() => sanitize(perName)).toThrow(SanitizeTooManyAttributesError);
  // the two reported bomb sizes: ~405 KB and ~811 KB, both far over the per-tag cap
  const segs = Array.from({ length: 100 }, (_, i) => `x${i}/`).join('');
  expect(() => sanitize(`<v ${(`a == ${segs} `).repeat(1024)}>`))
    .toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<v ${(`a == ${segs} `).repeat(2048)}>`))
    .toThrow(SanitizeTooManyAttributesError);
  // legit separators keep their value semantics and stay inside every cap
  expect(sanitize('<div a = 1 b == 2 class="x">ok</div>').html).toContain('class="x"');
  expect(sanitize('<div a/b c=3 href="http://example.com/a/b" class="x">ok</div>').html)
    .toContain('class="x"');
});

// Property check over the nested-foreign families: whatever the scan accepts, the real
// parse5 tree may never mint more than the per-tag or document budget. This catches a
// fresh under-count without enumerating one by hand.
test('accepted bodies never mint above the caps', () => {
  const pieces = [
    '<svg>', '</svg>', '<svg/>', '<math>', '</math>', '<foreignObject>', '</foreignObject>',
    '<desc>', '</desc>', '<title>', '</title>', '<mi>', '</mi>', '<mtext>', '</mtext>',
    '<div>', '</div>', '<p>', '</p>', '</br>', '<select>', '</select>', '<style>', '</style>',
    '<script>', '</script>', '<plaintext>', '<textarea>', '</textarea>', 'x', '<!--', '-->',
    'foo', '<foo>', '</foo>',
  ];
  const soup = ` <div ${Array.from({ length: 2016 }, (_, i) => `a${i}=1`).join(' ')}>`;
  let seed = 0x6a1d2b34;
  let nameSeq = 0;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const mintedMax = (body: string): { total: number; perTag: number } => {
    let total = 0;
    let perTag = 0;
    const walk = (node: any): void => {
      const count = node.attrs?.length ?? 0;
      total += count;
      if (count > perTag) perTag = count;
      for (const child of node.childNodes ?? []) walk(child);
    };
    walk(parse(body));
    return { total, perTag };
  };
  for (let run = 0; run < 2000; run += 1) {
    const parts = 1 + Math.floor(next() * 24);
    let body = '';
    for (let k = 0; k < parts; k += 1) body += pieces[Math.floor(next() * pieces.length)];
    if (next() < 0.5) body += soup;
    if (next() < 0.3) body += '<p class="x">ok</p>';
    try {
      sanitize(body);
    } catch (error) {
      const message = (error as Error).message;
      expect(message === 'plan uses too many attributes' || message === 'plan nests elements too deeply')
        .toBe(true);
      continue;
    }
    const { total, perTag } = mintedMax(body);
    expect(total).toBeLessThanOrEqual(MAX_ATTRIBUTES_TOTAL);
    expect(perTag).toBeLessThanOrEqual(MAX_ATTRIBUTES_PER_TAG);
  }
  // generic '='/'/' tag soup (the after-attribute-name class): after a bare name an `=`
  // opens that attribute's value while each following x segment is a real attribute, so
  // the generated names stay unique per segment — the tree cannot collapse this class
  // into duplicates — and both knob sizes are randomized wide enough to cross the caps.
  for (let run = 0; run < 300; run += 1) {
    let body = '<v ';
    const reps = 1 + Math.floor(next() * 300);
    const segs = 1 + Math.floor(next() * 120);
    for (let r = 0; r < reps; r += 1) {
      body += `a${nameSeq} ==`;
      for (let s = 0; s < segs; s += 1) {
        nameSeq += 1;
        body += `x${nameSeq}/`;
      }
      nameSeq += 1;
      body += ' ';
    }
    body += '>';
    try {
      sanitize(body);
    } catch (error) {
      const message = (error as Error).message;
      expect(message === 'plan uses too many attributes' || message === 'plan nests elements too deeply')
        .toBe(true);
      continue;
    }
    const { total, perTag } = mintedMax(body);
    expect(total).toBeLessThanOrEqual(MAX_ATTRIBUTES_TOTAL);
    expect(perTag).toBeLessThanOrEqual(MAX_ATTRIBUTES_PER_TAG);
  }
});


// parse5 spends super-linear time per attribute, so the attribute guard decides before
// the parser runs. The timing bounds are generous tripwires: every parse below takes
// single-digit milliseconds with the guard, and minutes without it.
test('attribute counts are bounded before parsing', () => {
  const attrs = (n: number): string => Array.from({ length: n }, (_, i) => `a${i}=1`).join(' ');
  const timed = (work: () => void, limit: number): void => {
    const start = Date.now();
    work();
    expect(Date.now() - start).toBeLessThan(limit);
  };

  timed(() => sanitize(`<div ${attrs(MAX_ATTRIBUTES_PER_TAG)}>x</div>`), 2000);
  expect(() => sanitize(`<div ${attrs(MAX_ATTRIBUTES_PER_TAG + 1)}>x</div>`)).toThrow(SanitizeTooManyAttributesError);
  // end tags carry the same budget: parse5 tokenizes their attributes before dropping them
  timed(() => sanitize(`<p>x</div ${attrs(MAX_ATTRIBUTES_PER_TAG)}>ok`), 2000);
  expect(() => sanitize(`<p>x</div ${attrs(MAX_ATTRIBUTES_PER_TAG + 1)}>ok`)).toThrow(SanitizeTooManyAttributesError);

  const tags = (n: number): string => `<p ${attrs(100)}>x</p>`.repeat(n / 100);
  timed(() => sanitize(tags(MAX_ATTRIBUTES_TOTAL)), 2000);
  expect(() => sanitize(tags(MAX_ATTRIBUTES_TOTAL + 1000))).toThrow(SanitizeTooManyAttributesError);

  // separate attr-name entries without whitespace cannot dodge the count
  expect(() => sanitize(`<div a="1"${'b="1"'.repeat(MAX_ATTRIBUTES_TOTAL)}>`)).toThrow(SanitizeTooManyAttributesError);
  expect(() => sanitize(`<div${'/a="1"'.repeat(MAX_ATTRIBUTES_TOTAL)}>`)).toThrow(SanitizeTooManyAttributesError);
  // an unquoted value swallows `/` and `=` as value characters, exactly like the parser
  expect(sanitize(`<div${'/title=1'.repeat(MAX_ATTRIBUTES_TOTAL)}>`).html).toContain('title="1/title=');
  expect(() => sanitize(`<div a==${' =x="1"'.repeat(MAX_ATTRIBUTES_TOTAL)}>`)).toThrow(SanitizeTooManyAttributesError);
  // svg style content is markup, not raw text, so hidden tags are still counted
  expect(() => sanitize(`<svg><style><div${' a=1'.repeat(9000)}></style></svg>`)).toThrow(SanitizeTooManyAttributesError);

  const table = (rows: number): string =>
    `<table>${'<tr><td a="1" b="2" c="3" d="4">x</td></tr>'.repeat(rows)}</table>`;
  let once = '';
  timed(() => { once = sanitize(table(3000)).html; }, 2000); // 12,000 attributes
  expect(sanitize(once).html).toBe(once);
  timed(() => sanitize('<br />'.repeat(20000)), 2000);
  timed(() => sanitize('<div>x<span>t</span></div>'.repeat(5000)), 2000);
});

test('CSS allows fragments and data images only', () => {
  expect(checkCss('p{fill:url(#grad)}')).toBeNull();
  expect(checkCss('p{background:url("data:image/png;base64,AAAA")}')).toBeNull();
  expect(checkCss('p{background:url(https://evil.example/a.png)}')).toBe('external URL');
  expect(checkCss('@import "x.css";')).toBe('unsafe CSS');
});

// A generated matrix of dangerous constructs, so the set is wide and stable: about 180 cases.
const MATRIX: string[] = [
  ...['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'form', 'input',
    'button', 'select', 'textarea', 'template', 'noscript', 'video', 'audio', 'source', 'track', 'canvas',
    'map', 'area', 'slot', 'portal', 'xmp', 'plaintext', 'listing', 'math', 'svg', 'use', 'image', 'animate',
    'set', 'foreignObject', 'style', 'meta'].map((tag) => `<${tag} src="https://evil.example/x" href="https://evil.example/y">x</${tag}>`),
  ...['href', 'src', 'action', 'formaction', 'background', 'poster', 'data', 'xlink:href', 'srcdoc'].flatMap((attr) =>
    ['javascript:alert(1)', 'java\tscript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>',
      'https://evil.example/x', '//evil.example/x'].map((value) => `<p ${attr}="${value}">x</p>`)),
  ...['<style>p{background:url(https://evil.example/x.png)}</style>',
    '<style>@import url(https://evil.example/x.css);</style>',
    '<style>p{background:u\\72l(https://evil.example/x.png)}</style>',
    '<style>p{width:expression(alert(1))}</style>',
    '<style>p{behavior:url(#default#time2)}</style>',
    '<style>p{-moz-binding:url(https://evil.example/x.xml#x)}</style>',
    '<style>p{content:"/*"}p{background:url(https://evil.example/x.png)}/**/</style>',
    '<style>@font-face{src:url(https://evil.example/x.woff2)}</style>',
    '<p style="background:url(https://evil.example/x.png)">x</p>',
    '<p style="background:url(javascript:alert(1))">x</p>',
    '<p style="width:expression(alert(1))">x</p>',
    '<p style="background:u\\72l(https://evil.example/x.png)">x</p>',
    '<svg><rect fill="url(https://evil.example/p.svg#p)"/></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><foreignObject><body onload="alert(1)"/></foreignObject></svg>',
    '<svg><style>@import url(https://evil.example/x.css)</style></svg>',
    '<svg><image href="https://evil.example/x.png"/></svg>',
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zy8+#a"/></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<meta http-equiv="Content-Security-Policy" content="default-src *">',
    '<meta name="referrer" content="unsafe-url">',
    '<meta name="viewport" content="width=device-width">',
    '<link rel="prefetch" href="https://evil.example/x">',
    '<link rel="preconnect" href="https://evil.example">',
    '<base href="https://evil.example/">',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<form action="https://evil.example"><input name="password"><button formaction="https://evil.example">Go</button></form>',
    '<img src="https://evil.example/x.png" alt="x">',
    '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="x">',
    '<img src="x" onerror="alert(1)">',
    '<img srcset="https://evil.example/x.png 1x" src="data:image/png;base64,AAAA">',
    '<body onload="alert(1)"><div onmouseover="x()">t</div></body>',
    '<details ontoggle="alert(1)" open><summary>s</summary></details>',
    '<table background="https://evil.example/x.png"><tr><td>t</td></tr></table>',
    '<a href="https://evil.example" ping="https://evil.example/p">x</a>',
    '<video poster="https://evil.example/x.png"><source src="https://evil.example/x.mp4"></video>',
    '<object data="https://evil.example/x.swf"></object>',
    '<embed src="https://evil.example/x.swf">',
    '<div data-x="1" aria-label="ok" role="note">x</div>',
    '<template><script>alert(1)</script></template>',
    '<noscript><p><img src=x onerror=alert(1)></p></noscript>',
    '<!--<script>alert(1)</script>-->',
    '<p style="x:y" onclick="alert(1)" ONMOUSEOVER="alert(2)">x</p>',
    '<a href="&#106;avascript:alert(1)">x</a>'].map((payload) => payload),
  ...['marquee', 'keygen', 'menuitem', 'bgsound', 'isindex', 'blink', 'spacer', 'layer', 'ilayer', 'xml',
    'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'BASE', 'LINK', 'META', 'STYLE', 'TEMPLATE'].map((tag) =>
    `<${tag} href="https://evil.example/x">x</${tag}>`),
  ...['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur', 'onsubmit', 'onkeydown'].map((handler) =>
    `<div ${handler}="alert(1)">x</div>`),
  ...['onClick', 'ONCLICK', 'OnClick'].map((handler) => `<div ${handler}="alert(1)">x</div>`),
  '<svg><script href="https://evil.example/x.js"/></svg>',
  '<svg><handler href="https://evil.example/x"/></svg>',
  '<svg><set attributeName="onload" to="alert(1)"/></svg>',
  '<svg><animateMotion path="M0,0"/></svg>',
  '<svg><feImage xlink:href="https://evil.example/x.png"/></svg>',
  '<svg><cursor xlink:href="https://evil.example/x.cur"/></svg>',
  '<p style="background:url(data:text/html,<script>alert(1)</script>)">x</p>',
  '<p style="background:u/**/rl(https://evil.example/x.png)">x</p>',
  '<p style="background:url (https://evil.example/x.png)">x</p>',
  '<style>p{background:url(\\68ttps://evil.example/x.png)}</style>',
  '<style>p{background:url(https\\3a //evil.example/x.png)}</style>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<iframe src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></iframe>',
  '<object data="data:text/html,x"></object>',
  '<embed src="data:text/html,x">',
  '<form><input type="password"></form>',
  '<input type="image" src="https://evil.example/x.png">',
  '<button form="f" formaction="https://evil.example">x</button>',
  '<video controls autoplay src="https://evil.example/x.mp4"></video>',
  '<audio controls src="https://evil.example/x.mp3"></audio>',
  '<track src="https://evil.example/x.vtt">',
  '<picture><source srcset="https://evil.example/x.png"><img src="data:image/png;base64,AAAA"></picture>',
  '<map name="m"><area href="https://evil.example/x" shape="rect"></map>',
  '<object><param name="movie" value="https://evil.example/x.swf"></object>',
  '<meta charset="utf-8"><meta name="description" content="ok">',
  '<link rel="dns-prefetch" href="//evil.example">',
  '<base target="_blank">',
  '<p style="background-image:image-set(url(https://evil.example/x.png) 1x)">x</p>',
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<div style="width:expression(alert(1))">x</div>',
  '<div style="behavior:url(#default#time2)">x</div>',
  '<div style="-moz-binding:url(https://evil.example/x.xml#x)">x</div>',
];

test('the generated adversarial matrix is clean after sanitising', () => {
  expect(MATRIX.length).toBeGreaterThanOrEqual(170);
  for (const payload of MATRIX) {
    try {
      assertClean(sanitize(payload).html);
    } catch (error) {
      throw new Error(`${payload} => ${error instanceof Error ? error.message : error}`);
    }
  }
});


test('the CSS parser keeps motion and media rules and strips imports, remote URLs and fonts', () => {
  const safe = sanitize('<style>@media (max-width:600px){p{color:red}}@supports (display:grid){p{display:grid}}@keyframes g{to{opacity:1}}</style>');
  expect(safe.removed['<style>']).toBeUndefined();
  expect(safe.html).toContain('@media (max-width:600px)');
  expect(safe.html).toContain('@keyframes g');
  for (const css of ['@import url(https://evil.example/x.css);', '@font-face{src:url(https://evil.example/x.woff2)}', 'p{background:url(https://evil.example/x.png)}']) {
    const bad = sanitize(`<style>${css}</style>`);
    expect(bad.html).not.toContain('evil.example');
    expect(Object.keys(bad.removed).length).toBeGreaterThan(0);
  }
});

test('hostile markup never eats the surrounding content', () => {
  for (const payload of HOSTILE) {
    const wrapped = `<p>keep-me</p>${payload}`;
    const output = sanitize(wrapped).html;
    assertClean(output);
    expect(output, payload).toContain('keep-me');
  }
});
