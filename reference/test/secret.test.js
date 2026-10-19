import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadOrCreateSecret } from '../src/secret.js';

test('an empty or short address key stops startup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-key-'));
  try {
    const file = join(dir, 'address.key');
    writeFileSync(file, '');
    assert.throws(() => loadOrCreateSecret(file), /missing or too short/);
    writeFileSync(file, 'short\n');
    assert.throws(() => loadOrCreateSecret(file), /missing or too short/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing address key is created once, and read back unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-key-'));
  try {
    const file = join(dir, 'nested', 'address.key');
    const first = loadOrCreateSecret(file);
    assert.ok(first.length >= 32);
    assert.equal(loadOrCreateSecret(file), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
