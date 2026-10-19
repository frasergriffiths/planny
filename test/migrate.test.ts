import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
