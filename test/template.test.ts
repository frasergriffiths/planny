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

test('line labels sit in one row under the plot; the mobile Gantt stacks without clipping', () => {
  for (const source of [template, sample]) {
    expect(rule(source, '.x-labels')).toContain('grid-template-columns: repeat(9, minmax(0, 1fr))');
    expect(source).toContain('.gantt-head { display: none; }');
    expect(source).toContain('.gantt-row { grid-template-columns: minmax(0, 1fr); margin-bottom: 12px; }');
    expect(source).toContain('repeating-linear-gradient');
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
