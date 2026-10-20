import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createSqliteStore } from '../src/stores/sqlite.js';

test('a legacy state.json is migrated once and renamed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-migrate-'));
  const legacy = join(dir, 'state.json');
  writeFileSync(legacy, JSON.stringify({
    strings: { 'planny:site:bytes': '1234' },
    hashes: { 'planny:plan:abc': { state: 'live', name: 'Old plan' } },
    zsets: { 'planny:expiring': { abc: 9999999999999 } },
    expires: {},
  }));
  const store = createSqliteStore({ file: join(dir, 'state.db'), legacyFile: legacy });
  const bytes = await store.transaction((run) => run('GET', ['planny:site:bytes']));
  expect(bytes).toBe('1234');
  const hash = await store.transaction((run) => run('HGETALL', ['planny:plan:abc']));
  expect(hash).toEqual({ state: 'live', name: 'Old plan' });
  const expired = await store.transaction((run) => run('ZRANGEBYSCORE', ['planny:expiring', '-inf', String(9999999999999), 'LIMIT', '0', '10']));
  expect(expired).toEqual(['abc']);
  expect(() => readFileSync(legacy)).toThrow();
  expect(readFileSync(`${legacy}.migrated`, 'utf8')).toContain('Old plan');

  const db = new Database(join(dir, 'state.db'));
  expect(db.query('SELECT COUNT(*) AS n FROM strings').get()).toEqual({ n: 1 });
  db.close();
  store.close();
});

test('a malformed legacy file is ignored and left in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-migrate-'));
  const legacy = join(dir, 'state.json');
  writeFileSync(legacy, '{ not json at all');
  const store = createSqliteStore({ file: join(dir, 'state.db'), legacyFile: legacy });
  const bytes = await store.transaction((run) => run('GET', ['planny:site:bytes']));
  expect(bytes).toBe(null);
  expect(existsSync(legacy)).toBe(true);
  expect(existsSync(`${legacy}.migrated`)).toBe(false);
});

test('a failed migration rolls back and does not rename the legacy file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-migrate-'));
  const legacy = join(dir, 'state.json');
  // A non-string counter value fails mid-migration, after earlier rows were written.
  writeFileSync(legacy, JSON.stringify({
    strings: { 'planny:site:bytes': '1234', 'planny:broken': { nope: true } },
    hashes: { 'planny:plan:abc': { state: 'live' } },
    zsets: {},
    expires: {},
  }));
  expect(() => createSqliteStore({ file: join(dir, 'state.db'), legacyFile: legacy })).toThrow();
  // Reopen without the legacy file: nothing from the failed migration survived.
  const store = createSqliteStore({ file: join(dir, 'state.db') });
  const bytes = await store.transaction((run) => run('GET', ['planny:site:bytes']));
  expect(bytes).toBe(null);
  const hash = await store.transaction((run) => run('HGETALL', ['planny:plan:abc']));
  expect(hash).toEqual({});
  expect(existsSync(legacy)).toBe(true);
  expect(existsSync(`${legacy}.migrated`)).toBe(false);
});

test('a failed transaction leaves earlier data intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-migrate-'));
  const store = createSqliteStore({ file: join(dir, 'state.db') });
  await store.transaction((run) => run('SET', ['planny:site:bytes', '500']));
  await expect(store.transaction((run) => {
    void run('SET', ['planny:site:bytes', '999']);
    throw new Error('mid-transaction failure');
  })).rejects.toThrow('mid-transaction failure');
  const bytes = await store.transaction((run) => run('GET', ['planny:site:bytes']));
  expect(bytes).toBe('500');
});
