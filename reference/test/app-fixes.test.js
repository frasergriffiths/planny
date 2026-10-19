import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';

const ORIGIN = 'http://127.0.0.1:4317';
const ADDRESS = '203.0.113.7';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><h1>Hello</h1><p>Body</p></body></html>';
const MONTH_READS = 'planny:month:2026-10:reads';
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-fix-'));
  const clock = { t: Date.UTC(2026, 9, 19, 12) };
  const logs = [];
  const store = createLocalStore({ dataDir });
  const config = loadConfig({});
  const app = createApp({
    build: 'local',
    store,
    config,
    secret: 'test-secret',
    origin: ORIGIN,
    now: () => clock.t,
    log: { error: (...args) => logs.push(args) },
  });
  return { app, store, config, clock, logs, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

function upload(t, { duration = '30d', body = PLAN } = {}) {
  const query = new URLSearchParams({ name: 'Plan', duration });
  return t.app.handle(new Request(`${ORIGIN}/plans?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body,
  }), { address: ADDRESS });
}

async function uploaded(t, options) {
  const response = await upload(t, options);
  assert.equal(response.status, 201);
  return response.json();
}

const fetchUrl = (t, url, init = {}) => t.app.handle(new Request(url, init), { address: ADDRESS });
const counter = (t, key) => t.store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []).then(Number);

test('a refused upload sweeps expired plans and then gets through, with no view needed', async () => {
  const t = setup();
  try {
    const first = await uploaded(t, { duration: '1h' });
    t.config.siteStoredBytes = Math.floor(first.bytes * 1.5);
    const refused = await upload(t);
    assert.equal(refused.status, 503);
    assert.equal((await refused.json()).error.code, 'storage_full');

    t.clock.t += 2 * 3600e3;
    const accepted = await upload(t);
    assert.equal(accepted.status, 201);
    const json = await accepted.json();
    assert.equal((await t.app.records.get(first.id)).state, 'gone');
    assert.equal(await counter(t, 'planny:site:bytes'), json.bytes);
  } finally {
    t.cleanup();
  }
});

test('a plan link with a query string is a 404, and it is not counted as a read', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    const odd = await fetchUrl(t, `${json.url}?x=1`);
    assert.equal(odd.status, 404);
    assert.equal(await counter(t, MONTH_READS), 0);
    const plain = await fetchUrl(t, json.url);
    assert.equal(plain.status, 200);
    assert.equal(await counter(t, MONTH_READS), 1);
  } finally {
    t.cleanup();
  }
});

test('a failed blob delete leaves the bytes counted until a later sweep finishes the job', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    const original = t.store.blobs.remove;
    let failures = 1;
    t.store.blobs.remove = async (id) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('storage unavailable');
      }
      return original(id);
    };
    const del = await fetchUrl(t, json.url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${json.deleteKey}` },
    });
    assert.equal(del.status, 200);
    assert.equal((await t.app.records.get(json.id)).state, 'removing');
    assert.equal(await counter(t, 'planny:site:bytes'), json.bytes);

    t.clock.t += 16 * 60e3;
    const results = await t.app.sweep();
    assert.equal(results.find((result) => result.id === json.id)?.outcome, 'ok');
    assert.equal((await t.app.records.get(json.id)).state, 'gone');
    assert.equal(await counter(t, 'planny:site:bytes'), 0);
    assert.equal(await t.store.blobs.get(json.id), null);
  } finally {
    t.cleanup();
  }
});

test('deeply nested markup gets a 400 too_deep, not a server error', async () => {
  const t = setup();
  try {
    const response = await upload(t, { body: '<div>'.repeat(5000) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'too_deep');
    assert.deepEqual(t.logs, []);
  } finally {
    t.cleanup();
  }
});

test('takedown frees the byte budget as well as the file', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    assert.equal(await counter(t, 'planny:site:bytes'), json.bytes);
    await t.app.takedown(json.id);
    assert.equal(await counter(t, 'planny:site:bytes'), 0);
    assert.equal(await counter(t, 'planny:owner:' + (await t.app.records.get(json.id)).owner + ':bytes'), 0);
    await flush();
  } finally {
    t.cleanup();
  }
});
