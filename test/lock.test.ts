import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';
import { createRecords } from '../src/records.js';
import { createLocalStore } from '../src/stores/local.js';
import { newClaimId, newPlanId, sha256Hex } from '../src/util.js';

const run = promisify(execFile);

// Lens's item 8: the server and admin commands are separate processes sharing one store,
// so a reservation from one must not overwrite another's write. SQLite makes it atomic.
const client = `
const { createRecords } = await import(process.env.RECORDS);
const { createLocalStore } = await import(process.env.STORE);
const { newClaimId, newPlanId, sha256Hex } = await import(process.env.UTIL);
const records = createRecords(createLocalStore({ dataDir: process.env.DATA_DIR }).redis);
await new Promise((resolve) => setTimeout(resolve, Number(process.env.DELAY_MS)));
const outcome = await records.reserve({
  id: newPlanId(),
  claimId: newClaimId(),
  now: Date.now(),
  owner: 'owner-a',
  bytes: 100,
  name: 'Plan',
  expiresAt: Date.now() + 60000,
  deleteKeyHash: sha256Hex('key'),
  limits: { site: 1000, owner: 10000, monthlyUploads: 1000 },
});
console.log(outcome);
`;

test('20 processes cannot overspend the shared budget', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-lock-'));
  const script = join(dataDir, 'client.ts');
  writeFileSync(script, client);
  try {
    const env = {
      ...process.env,
      RECORDS: fileURLToPath(new URL('../src/records.ts', import.meta.url)),
      STORE: fileURLToPath(new URL('../src/stores/local.ts', import.meta.url)),
      UTIL: fileURLToPath(new URL('../src/util.ts', import.meta.url)),
      DATA_DIR: dataDir,
      DELAY_MS: '25',
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => run(process.execPath, ['run', script], { env })),
    );
    const outcomes = results.map((result) => result.stdout.trim());
    expect(outcomes.filter((outcome) => outcome === 'ok').length).toBe(10);
    const store = createLocalStore({ dataDir });
    const total = await store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", ['planny:site:bytes'], []);
    expect(Number(total)).toBe(1000);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 60_000);

test('two stores over one SQLite file see each other', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-lock-'));
  try {
    const a = createRecords(createLocalStore({ dataDir }).redis);
    const b = createRecords(createLocalStore({ dataDir }).redis);
    const id = newPlanId();
    const claim = newClaimId();
    expect(await a.reserve({
      id,
      claimId: claim,
      now: 1000,
      owner: 'owner-a',
      bytes: 10,
      name: 'Two stores',
      expiresAt: 1e12,
      deleteKeyHash: sha256Hex('k'),
      limits: { site: 1e6, owner: 1e6, monthlyUploads: 100 },
    })).toBe('ok');
    expect((await b.get(id))?.name).toBe('Two stores');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
