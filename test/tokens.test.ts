import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const root = join(import.meta.dir, '..');
const tokenNames = ['radius-card', 'radius-bar', 'radius-swatch', 'line', 'accent', 'panel', 'inset-card', 'border-card'] as const;
type TokenName = (typeof tokenNames)[number];
type Tokens = Record<TokenName, string>;

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from + start.length, to);
}

function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start + selector.length + 2, end);
}

function px(value: string | undefined): number {
  expect(value).toMatch(/^\d+px$/);
  return Number(value!.replace(/px$/, ''));
}

function isPixel(name: TokenName): boolean {
  return name.startsWith('radius-') || name === 'inset-card' || name === 'border-card';
}

function cssName(name: TokenName): string {
  if (name.startsWith('radius-') || name === 'inset-card' || name === 'border-card') return `--${name}`;
  return `--color-${name}`;
}

const tokens = JSON.parse(read('tokens.json')) as Tokens;
const template = read('skills/planny/template.html');
const sample = read('public/sample/index.html');
const theme = read('web/src/index.css');
const templateDecls = declarations(between(template, '/* TOKENS */', '/* /TOKENS */'));
const sampleDecls = declarations(between(sample, '/* TOKENS */', '/* /TOKENS */'));
const themeDecls = declarations(between(theme, '/* TOKENS:THEME */', '/* /TOKENS:THEME */'));
const padCard = `${px(tokens['inset-card']) - px(tokens['border-card'])}px`;

test('tokens.json has exactly the agreed names and valid values', () => {
  expect(Object.keys(tokens).sort()).toEqual([...tokenNames].sort());
  for (const name of tokenNames) {
    const value = tokens[name];
    expect(typeof value).toBe('string');
    if (isPixel(name)) expect(value).toMatch(/^\d+px$/);
    else expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
  }
});

test('the generator reports every generated block in sync', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', 'scripts/generate-tokens.ts', '--check'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.stderr.toString()).toBe('');
  expect(result.stdout.toString()).toContain('tokens up to date');
  expect(result.exitCode).toBe(0);
});

test('the template and sample :root blocks carry every token value', () => {
  expect(templateDecls.size).toBe(tokenNames.length + 1);
  expect(sampleDecls.size).toBe(tokenNames.length + 1);
  for (const name of tokenNames) {
    expect(templateDecls.get(`--${name}`)).toBe(tokens[name]);
    expect(sampleDecls.get(`--${name}`)).toBe(tokens[name]);
  }
  expect(templateDecls.get('--pad-card')).toBe(padCard);
  expect(sampleDecls.get('--pad-card')).toBe(padCard);
});

test('the Tailwind theme carries every token value', () => {
  expect(themeDecls.size).toBe(tokenNames.length + 1);
  for (const name of tokenNames) {
    expect(themeDecls.get(cssName(name))).toBe(tokens[name]);
  }
  expect(themeDecls.get('--pad-card')).toBe(padCard);
});

test('the card padding adds up to the inset and headings share the column edge', () => {
  for (const decls of [templateDecls, sampleDecls, themeDecls]) {
    expect(px(decls.get('--border-card')) + px(decls.get('--pad-card')))
      .toBe(px(decls.get('--inset-card')));
  }
  for (const source of [template, sample]) {
    expect(rule(source, '.box')).toContain('border-left: var(--border-card) solid var(--accent)');
    expect(rule(source, '.box')).toContain('var(--pad-card)');
    expect(rule(source, '.kpi')).toContain('border-left: var(--border-card) solid var(--accent)');
    expect(rule(source, '.kpi')).toContain('var(--pad-card)');
    expect(rule(source, '.box')).not.toContain('border: 1px');
    expect(rule(source, '.box')).not.toContain('var(--radius-card)');
    expect(rule(source, '.box.outline')).toContain('border: 1px solid var(--line)');
    expect(rule(source, '.box.outline')).toContain('border-radius: var(--radius-card)');
    expect(rule(source, '.box.outline')).toContain('padding: calc(var(--inset-card) - 1px)');
    expect(rule(source, '.kpi.outline')).toContain('border: 1px solid var(--line)');
    expect(rule(source, '.kpi.outline')).toContain('border-radius: var(--radius-card)');
    expect(rule(source, '.kpi.outline')).toContain('padding: calc(var(--inset-card) - 1px)');
    expect(source).not.toContain('main > section > h2, aside > section > h3');
    expect(rule(source, 'h2')).not.toContain('padding-left');
    expect(rule(source, 'h3')).not.toContain('padding-left');
    expect(rule(source, '.measure')).not.toContain('padding-left');
  }
  const card = rule(theme, '.plan-card');
  expect(card).toContain('border: 0');
  expect(card).toContain('border-left: var(--border-card) solid var(--color-accent)');
  expect(card).toContain('border-radius: 0');
  expect(card).toContain('padding: var(--pad-card)');
  expect(card).toContain('background: transparent');
  expect(card).not.toContain('border: 1px');
  const outline = rule(theme, '.plan-card-outline');
  expect(outline).toContain('border: 1px solid var(--color-line)');
  expect(outline).toContain('border-radius: var(--radius-card)');
  expect(outline).toContain('padding: calc(var(--inset-card) - 1px)');
  expect(outline).toContain('background: transparent');
});

test('small bars and swatches use the token radii; base cards stay square', () => {
  for (const source of [template, sample]) {
    expect(rule(source, '.bar')).toContain('border-radius: var(--radius-bar)');
    expect(rule(source, '.swatch')).toContain('border-radius: var(--radius-swatch)');
    expect(rule(source, '.chart-bar')).toContain('rx: var(--radius-bar)');
    expect(rule(source, '.box')).toContain('border-radius: 0');
    expect(rule(source, '.kpi')).toContain('border-radius: 0');
    expect(rule(source, '.box.outline')).toContain('border-radius: var(--radius-card)');
    expect(rule(source, '.kpi.outline')).toContain('border-radius: var(--radius-card)');
    if (source === sample) {
      expect(rule(source, '.stacked')).toContain('border-radius: var(--radius-bar)');
      expect(rule(source, '.chart')).toContain('border-left: var(--border-card) solid var(--accent)');
      expect(rule(source, '.chart')).toContain('border-radius: 0');
      expect(rule(source, '.chart')).not.toContain('border: 1px');
    }
  }
});

test('the sample keeps the quiet budget total and the rich sections', () => {
  expect(rule(sample, '.box')).toContain('background: transparent');
  expect(rule(sample, '.box')).toContain('border: 0');
  expect(sample).toContain('class="box outline"');
  expect(sample).toContain('<div class="eyebrow">Open questions</div>');
  expect(sample).toContain('<div class="eyebrow">Definition of done</div>');
  expect(sample).not.toContain('border-left: 4px');
  expect(rule(sample, '.stacked')).toContain('gap: 2px');
  expect(rule(sample, '.budget-total')).toContain('color: var(--muted)');
  expect(rule(sample, '.budget-total')).toContain('font-size: 12px');
  for (const section of ['Timeline', 'Milestones', 'Decisions', 'Risks', 'Next steps']) {
    expect(sample).toContain(`<h2>${section}</h2>`);
  }
});

test('the sample is generated from the template stylesheet and body', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', 'scripts/generate-sample.ts', '--check'],
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.stderr.toString()).toBe('');
  expect(result.stdout.toString()).toContain('sample up to date');
  expect(result.exitCode).toBe(0);
  expect(between(sample, '<style>\n', '\n</style>')).toBe(between(template, '<style>\n', '\n</style>'));
  expect(sample).toContain('<title>Harbor Coffee Roasters: 2027 subscription plan</title>');
});

test('the React pages use both card variants', () => {
  const page = read('web/src/Page.tsx');
  expect(page.match(/plan-card-outline/g)?.length).toBe(1);
  expect(page).toContain('plan-card mx-auto my-16 max-w-2xl');
  expect(page).not.toContain('plan-card-outline p-4');
  expect(page).not.toContain('plan-card p-4');
  expect(page).not.toContain('plan-card mx-auto my-16 max-w-2xl p-8');
  const left = rule(theme, '.plan-card');
  expect(left).toContain('padding: var(--pad-card)');
  expect(left).toContain('border-left: var(--border-card) solid var(--color-accent)');
  expect(left).toContain('border-radius: 0');
  const outline = rule(theme, '.plan-card-outline');
  expect(outline).toContain('border: 1px solid var(--color-line)');
  expect(outline).toContain('border-radius: var(--radius-card)');
  expect(outline).toContain('padding: calc(var(--inset-card) - 1px)');
  expect(theme).not.toContain('.plan-card::before');
});

test('/terms-of-use is routed, linked and carries the retention licence', async () => {
  const { PAGES } = await import('../src/generated-pages.js');
  expect(PAGES.terms).toContain('data-page="terms"');
  expect(PAGES.terms).toContain('frasergriffithsisme@icloud.com');
  expect(PAGES.terms).toContain('kept indefinitely');
  const page = read('web/src/Page.tsx');
  expect(page).toContain('href="/terms-of-use"');
  const app = read('src/app.ts');
  expect(app).toContain("app.get('/terms-of-use'");
});

test('/sample is served with the plan CSP and a CTA', async () => {
  const { PAGES } = await import('../src/generated-pages.js');
  expect(PAGES.sample).toContain('<title>Harbor Coffee Roasters');
  expect(PAGES.sample).toContain('<h2>Timeline</h2>');
  const appSource = read('src/app.ts');
  expect(appSource).toContain("app.get('/sample'");
  expect(appSource).toContain('PAGES.sample');
  expect(appSource).toContain('SAMPLE_CSP');
  expect(appSource).toContain('Make your own plan');
});
