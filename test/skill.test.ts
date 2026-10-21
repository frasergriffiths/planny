import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

test('the planny skill advertises a one-command install', () => {
  const skill = readFileSync('skills/planny/SKILL.md', 'utf8');
  expect(skill).toContain('npx skills add frasergriffiths/planny --skill planny');
});

test('the skill scripts are Node-compatible .mjs files', () => {
  expect(existsSync('skills/planny/scripts/publish.mjs')).toBe(true);
  expect(existsSync('skills/planny/scripts/delete.mjs')).toBe(true);
  const skill = readFileSync('skills/planny/SKILL.md', 'utf8');
  expect(skill).toContain('scripts/publish.mjs');
  expect(skill).toContain('scripts/delete.mjs');
  expect(skill).not.toContain('publish.ts');
  expect(skill).not.toContain('delete.ts');
});

test('the skill ships four templates and requires the unslop rules', () => {
  const skill = readFileSync('skills/planny/SKILL.md', 'utf8');
  expect(skill).toContain('reference/unslop.md');
  expect(skill).toContain('before writing a plan');
  for (const path of [
    'skills/planny/template.html',
    'skills/planny/templates/launch-plan.html',
    'skills/planny/templates/research-plan.html',
    'skills/planny/templates/decision-plan.html',
  ]) {
    expect(existsSync(path)).toBe(true);
  }
  const unslop = readFileSync('skills/planny/reference/unslop.md', 'utf8');
  expect(unslop).toContain('Bundled from the unslop skill');
  expect(unslop).toContain('Patterns to detect and fix');
  expect(unslop).toContain('Plain speech');
});

test('the unslop rules ship once, inside the planny skill', () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'unslop.md') found.push(path);
    }
  };
  walk('skills');
  expect(found).toEqual([join('skills', 'planny', 'reference', 'unslop.md')]);
  const skill = readFileSync('skills/planny/SKILL.md', 'utf8');
  expect(skill).not.toMatch(/skills add unslop/i);
});

test('the skill documents code blocks, the viewer copy button and the icon set', () => {
  const skill = readFileSync('skills/planny/SKILL.md', 'utf8');
  expect(skill).toContain('code-block');
  expect(skill).toContain('Copy button');
  expect(skill).toContain('reference/icons.md');
  const components = readFileSync('skills/planny/reference/components.md', 'utf8');
  expect(components).toContain('Code blocks with a copy button');
  expect(components).toContain('.tok-key');
  expect(components).toContain('Heroicons');
  const commands = readFileSync('skills/planny/commands/planny.md', 'utf8');
  expect(commands).toContain('.code-block');
  expect(commands).toContain('reference/icons.md');
});
