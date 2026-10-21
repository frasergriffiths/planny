import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const root = join(import.meta.dir, '..');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

// The editorial template contract: compact type, wrapped tables and Gantt,
// quiet chart cards, and HTML/CSS chart labels whose px size never scales.
const template = read('skills/planny/template.html');
const sample = read('public/sample/index.html');
const reference = read('skills/planny/reference/components.md');

test('the template uses the editorial type scale with a centred 1240px page', () => {
  for (const source of [template, sample]) {
    expect(source).toContain('max-width: 1240px');
    expect(source).toContain('font-size: clamp(34px, 5.5vw, 64px)');
    expect(source).toContain('font-size: clamp(22px, 2.8vw, 30px)');
    expect(source).toContain('font-size: clamp(16px, 1.6vw, 20px)');
    expect(source).toContain('font-size: clamp(24px, 2.4vw, 30px)');
    expect(source).toContain('text-wrap: balance');
  }
});

test('tables and the Gantt scroll inside their region on phones', () => {
  for (const source of [template, sample]) {
    expect(rule(source, '.table-wrap')).toContain('overflow-x: auto');
    expect(rule(source, '.gantt-wrap')).toContain('overflow-x: auto');
    expect(rule(source, '.gantt')).toContain('min-width: 640px');
    expect(rule(source, '.table-wrap table')).toContain('min-width: 520px');
  }
  expect(sample).toMatch(/<div class="table-wrap">\s*<table>/g);
  expect(sample.match(/<div class="table-wrap">/g)?.length).toBe(3);
  expect(sample).toContain('<div class="gantt-wrap">');
});

test('charts are quiet cards and chart labels are fixed CSS pixels', () => {
  for (const source of [template, sample]) {
    expect(rule(source, '.chart-card')).toContain('border: 1px solid var(--line)');
    expect(rule(source, '.chart-card')).not.toContain('border-left');
    expect(rule(source, '.hbar .val')).toContain('font-size: 12px');
    expect(rule(source, '.y-label')).toContain('font-size: 12px');
    expect(source).not.toContain('transform-box: fill-box');
  }
});

test('stretchable SVG charts carry no SVG text; the fixed-size donut keeps it', () => {
  for (const match of sample.matchAll(/<svg viewBox="0 0 800 200"[^>]*>/g)) {
    const plot = sample.slice(match.index!, match.index! + 1600);
    expect(plot).not.toContain('<text');
    expect(match[0]).toContain('preserveAspectRatio="none"');
  }
  // The donut is 104px fixed, so its two text labels may stay in the SVG.
  expect(sample).toContain('width="104" height="104" viewBox="0 0 104 104"');
  expect(sample).toContain('plan versus pay-as-you-go');
});

test('line labels sit in one row under the plot; the mobile Gantt stacks without clipped text', () => {
  for (const source of [template, sample]) {
    expect(rule(source, '.x-labels')).toContain('grid-template-columns: repeat(9, minmax(0, 1fr))');
    expect(source).toContain('.gantt-head { display: none; }');
    expect(source).toContain('.gantt-row { grid-template-columns: minmax(0, 1fr); margin-bottom: 12px; }');
    expect(source).toContain('repeating-linear-gradient');
    expect(source).toContain('.gantt-row .bar { height: 16px; padding: 0; font-size: 0; }');
    expect(source).toContain('.gantt-note { display: block;');
    expect(source.match(/class="gantt-note"/g)?.length).toBeGreaterThanOrEqual(5);
  }
  for (const path of templatePaths) {
    expect(read(path).match(/class="gantt-note"/g)?.length).toBe(5);
  }
});

test('charts are accessible with one complete description per chart', () => {
  expect(rule(sample, '.chart-legend')).toContain('font-size: 12px');
  const charts = sample.match(/role="img" aria-label="[^"]+"/g) ?? [];
  expect(charts.length).toBeGreaterThanOrEqual(4);
  expect(sample).toContain('aria-hidden="true"');
});

test('the sample shows the mobile label-thinning rule and keeps reduced motion and print styles', () => {
  expect(sample).toContain('.x-labels span:nth-child(2n) { visibility: hidden; }');
  expect(sample).toContain('@media (prefers-reduced-motion: reduce)');
  expect(sample).toContain('.kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
  expect(sample).not.toContain('planny-pink');
  for (const source of [template, sample, reference]) expect(source).not.toContain('planny-pink');
});

function rule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  return source.slice(start + selector.length + 2, end);
}

// Every template is self-contained and follows four numbered task steps.
const templatePaths = [
  'skills/planny/template.html',
  'skills/planny/templates/launch-plan.html',
  'skills/planny/templates/research-plan.html',
  'skills/planny/templates/decision-plan.html',
];

const spines: Record<string, string[]> = {
  'skills/planny/template.html': ['Lease', 'Fit-out', 'Timetable', 'Open'],
  'skills/planny/templates/launch-plan.html': ['Batch', 'Dealers', 'Build', 'Demo'],
  'skills/planny/templates/research-plan.html': ['Questions', 'Method', 'Fieldwork', 'Report'],
  'skills/planny/templates/decision-plan.html': ['Criteria', 'Options', 'Trial', 'Decision'],
};

test('four templates exist and each carries its numbered tasks in order', () => {
  for (const path of templatePaths) {
    const source = read(path);
    expect(source).toContain('class="spine"');
    const steps = spines[path]!;
    expect(steps).toHaveLength(4);
    const order = steps.map((step, index) => source.indexOf(`<div class="eyebrow">0${index + 1} ${step}</div>`));
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(source.match(/class="spine-section"/g)?.length).toBe(4);
    // The top nav carries the same task names, with no Who/Why/What/When labels.
    for (const [index, step] of steps.entries()) {
      expect(source).toContain(`<span>0${index + 1}</span>${step}</div>`);
    }
    for (const label of ['Who', 'Why', 'What', 'When']) {
      expect(source).not.toContain(`<div class="eyebrow">${label}</div>`);
    }
  }
});

test('templates stay inside the sanitiser: no scripts, forms, frames or remote URLs', () => {
  for (const path of templatePaths) {
    const source = read(path);
    expect(source).not.toMatch(/<script/i);
    expect(source).not.toMatch(/<form/i);
    expect(source).not.toMatch(/<iframe/i);
    expect(source).not.toMatch(/https?:\/\//i);
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThan(4 * 1024 * 1024);
  }
});

test('each template names its audience, budget and review cadence', () => {
  for (const path of templatePaths) {
    const source = read(path);
    expect(source).toContain('Decision maker');
    expect(source).toContain('Budget');
    expect(source).toContain('Review cadence');
  }
});

test('the template ships a code block with static tokens and copy-button styles', () => {
  for (const source of [template, sample]) {
    expect(source).toContain('.code-block');
    expect(source).toContain('.code-head');
    expect(rule(source, '.code-copy')).toContain('cursor: pointer');
    expect(rule(source, '.code-copy')).toContain('width: 32px');
    expect(rule(source, '.code-copy')).toContain('height: 32px');
    for (const token of ['tok-key', 'tok-string', 'tok-number', 'tok-comment', 'tok-fn', 'tok-punct', 'tok-tag', 'tok-attr', 'tok-bool']) {
      expect(source).toContain(`.${token}`);
    }
  }
  expect(template).toContain('<div class="code-block">');
  expect(template).toContain('<span class="tok-key">');
  expect(sample).toContain('<div class="code-block">');
  // Every template carries the styles; the launch template also shows a block.
  for (const path of templatePaths) {
    const source = read(path);
    expect(source).toContain('.code-copy');
    expect(source).toContain('.tok-key');
  }
  expect(read('skills/planny/templates/launch-plan.html')).toContain('<div class="code-block">');
  // The button is viewer-owned: plan markup must not carry one.
  expect(template).not.toContain('<button');
  expect(sample).not.toContain('<button');
  expect(read('skills/planny/templates/launch-plan.html')).not.toContain('<button');
});

test('the templates use a small set of inline Heroicons', () => {
  const icons = read('skills/planny/reference/icons.md');
  const count = icons.match(/<svg[\s\S]*?<\/svg>/g)?.length ?? 0;
  expect(count).toBeGreaterThanOrEqual(16);
  expect(icons).toContain('stroke="currentColor"');
  expect(icons).toContain('aria-hidden="true"');
  expect(icons).toContain('MIT License');
  expect(icons).toContain('Copyright (c) Tailwind Labs, Inc.');
  const used = template.match(/class="spine-icon"/g)?.length ?? 0;
  expect(used).toBeGreaterThanOrEqual(2);
  expect(used).toBeLessThanOrEqual(3);
});
