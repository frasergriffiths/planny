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
