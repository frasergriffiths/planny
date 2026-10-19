import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalStore } from '../src/stores/local.js';
import { createVercelStore } from '../src/stores/vercel.js';

test('the local upload switch is on only when the file says true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planny-switch-'));
  try {
    const store = createLocalStore({ dataDir: dir });
    assert.equal(await store.control.uploadsEnabled(), true);
    const file = join(dir, 'control.json');
    writeFileSync(file, JSON.stringify({ uploadsEnabled: 'false' }));
    assert.equal(await store.control.uploadsEnabled(), false);
    writeFileSync(file, JSON.stringify({}));
    assert.equal(await store.control.uploadsEnabled(), false);
    writeFileSync(file, JSON.stringify({ uploadsEnabled: true }));
    assert.equal(await store.control.uploadsEnabled(), true);
    await store.control.setUploadsEnabled(false);
    assert.equal(await store.control.uploadsEnabled(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Vercel upload switch is on only for true, and anything else pauses uploads', async () => {
  for (const value of ['false', undefined, 0, null, 'true', 1, {}]) {
    const store = createVercelStore({
      env: {},
      client: {},
      blob: {},
      readConfig: async () => value,
      purge: async () => {},
    });
    assert.equal(await store.control.uploadsEnabled(), value === true, JSON.stringify(value));
  }
  const unreadable = createVercelStore({
    env: {},
    client: {},
    blob: {},
    readConfig: async () => {
      throw new Error('global config unreachable');
    },
    purge: async () => {},
  });
  await assert.rejects(unreadable.control.uploadsEnabled());
});
