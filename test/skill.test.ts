import { existsSync, readFileSync } from 'node:fs';
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
