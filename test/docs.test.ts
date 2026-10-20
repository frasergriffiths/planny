import { readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';

const docs = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/architecture.md',
  'docs/self-hosting.md',
  'docs/runbook.md',
  'docs/terms-of-use.md',
  'skills/planny/SKILL.md',
  '.env.example',
];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('docs do not mention retired origins or the old skill script names', () => {
  for (const path of docs) {
    const text = read(path);
    expect(text, path).not.toContain('planny-pink.vercel.app');
    expect(text, path).not.toContain('planny-link.vercel.app');
    expect(text, path).not.toContain('scripts/publish.ts');
    expect(text, path).not.toContain('scripts/delete.ts');
  }
});

test('docs describe the current install, self-host override and private store', () => {
  expect(read('README.md')).toContain('npx skills add frasergriffiths/planny --skill planny');
  expect(read('skills/planny/SKILL.md')).toContain('PLANNY_URL');
  expect(read('docs/self-hosting.md')).toContain('PLANNY_URL');
  expect(read('.env.example')).toContain('BLOB_ACCESS=private');
  expect(read('.env.example')).not.toContain('Launch limits');
});

test('docs describe the GitHub terms redirect rather than a hosted terms page', () => {
  expect(read('docs/terms-of-use.md')).toContain('Canonical terms document');
  expect(read('CONTRIBUTING.md')).not.toContain('React route is wired separately');
  expect(read('README.md')).toContain('/terms-of-use');
});
