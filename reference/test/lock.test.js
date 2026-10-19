import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRecords } from '../src/records.js';
import { createLocalStore } from '../src/stores/local.js';
import { newClaimId, newPlanId, sha256Hex } from '../src/util.js';

const run = promisify(execFile);

// Lens's item 8: the server and admin commands are separate processes sharing one state file,
// so a reservation from one must not overwrite the other's write.
const clientScript = `
const { createRecords } = await import(process.env.MODULE);
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
  expiresAt: Date.now() + 60_000,
  deleteKeyHash: sha256Hex('key'),
  limits: { site: 1000, owner: 10_000, monthlyUploads: 1000 },
});
console.log(outcome);
`;

test('concurrent processes cannot overspend the shared budget', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-lock-'));
  try {
    const env = {
      ...process.env,
      MODULE: fileURLToPath(new URL('../src/records.js', import.meta.url)),
      STORE: fileURLToPath(new URL('../src/stores/local.js', import.meta.url)),
      UTIL: fileURLToPath(new URL('../src/util.js', import.meta.url)),
      DATA_DIR: dataDir,
      DELAY_MS: '15',
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => run(process.execPath, ['--input-type=module', '-e', clientScript], { env })),
    );
    const outcomes = results.map((result) => result.stdout.trim());
    assert.equal(outcomes.filter((outcome) => outcome === 'ok').length, 10);
    const store = createLocalStore({ dataDir });
    const total = await store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", ['planny:site:bytes'], []);
    assert.equal(Number(total), 1000);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
