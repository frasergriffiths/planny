import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLuaRunner } from '../src/stores/lua-runner.js';
import { createMiniRedis } from '../src/stores/mini-redis.js';
import { createVercelStore } from '../src/stores/vercel.js';
import { createVercelApp } from '../src/vercel.js';

const ORIGIN = 'https://planny-pink.vercel.app';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><p onclick="x()">Hi</p></body></html>';

// Upstash stand-in: the same Lua and the same store code as the local build, behind the calls
// the Vercel store makes. zrange is checked against the shape the real client takes.
function fakeUpstash(dir) {
  const db = createMiniRedis({ file: join(dir, 'state.json') });
  const runner = createLuaRunner();
  return {
    async eval(script, keys, args) {
      return db.transaction((run) => runner.run(script, keys, args, run));
    },
    async hgetall(key) {
      return db.transaction((run) => run('HGETALL', [key]));
    },
    async zrange(key, min, max, options) {
      assert.equal(min, '-inf');
      assert.equal(options.byScore, true);
      return db.transaction((run) => run('ZRANGEBYSCORE', [key, min, String(max), 'LIMIT', String(options.offset), String(options.count)]));
    },
  };
}

function fakeBlob() {
  const files = new Map();
  return {
    files,
    async put(pathname, body, options) {
      assert.equal(options.access, 'private');
      assert.equal(options.addRandomSuffix, false);
      files.set(pathname, Buffer.from(body));
    },
    async get(pathname, options) {
      assert.equal(options.access, 'private');
      if (!files.has(pathname)) return null;
      return { statusCode: 200, stream: new Blob([files.get(pathname)]).stream() };
    },
    async del(pathname) {
      files.delete(pathname);
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'planny-glue-'));
  const clock = { t: Date.UTC(2026, 9, 19, 12) };
  const purged = [];
  const control = { uploadsEnabled: true, fail: false };
  const blob = fakeBlob();
  const client = fakeUpstash(dir);
  const app = createVercelApp({
    env: { PLANNY_ADDRESS_KEY: 'test-key' },
    client,
    blob,
    now: () => clock.t,
    log: { error() {} },
    readConfig: async (key) => {
      if (control.fail) throw new Error('global config unreachable');
      return key === 'uploadsEnabled' ? control.uploadsEnabled : undefined;
    },
    purge: async (tag) => {
      purged.push(tag);
    },
  });
  return { app, blob, clock, control, purged, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const upload = (t, { duration = '1h', body = PLAN } = {}) => t.app.handle(
  new Request(`${ORIGIN}/plans?name=Glue&duration=${duration}`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body,
  }),
  { address: '198.51.100.9' },
);

test('the Vercel build stores HTML privately and answers with the public origin', async () => {
  const t = setup();
  try {
    const response = await upload(t);
    assert.equal(response.status, 201);
    const json = await response.json();
    assert.ok(json.url.startsWith(`${ORIGIN}/p/`));
    assert.equal(json.build, 'vercel');
    assert.ok(t.blob.files.has(`plans/${json.id}.html`));
    assert.doesNotMatch(t.blob.files.get(`plans/${json.id}.html`).toString(), /onclick/);

    const page = await t.app.handle(new Request(json.url), { address: '198.51.100.9' });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-planny-build'), 'vercel');
    assert.equal(page.headers.get('vercel-cache-tag'), `plan-${json.id}`);
    assert.doesNotMatch(await page.text(), /LOCAL/);
  } finally {
    t.cleanup();
  }
});

test('deleting purges the cache tag, and the page is gone', async () => {
  const t = setup();
  try {
    const json = await (await upload(t)).json();
    const del = await t.app.handle(new Request(json.url, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${json.deleteKey}` },
    }), { address: '198.51.100.9' });
    assert.equal(del.status, 200);
    assert.deepEqual(t.purged, [`plan-${json.id}`]);
    assert.equal(t.blob.files.has(`plans/${json.id}.html`), false);
    const gone = await t.app.handle(new Request(json.url), { address: '198.51.100.9' });
    assert.equal(gone.status, 410);
  } finally {
    t.cleanup();
  }
});

test('the upload switch stops uploads, and a failed read of the switch fails closed', async () => {
  const t = setup();
  try {
    t.control.uploadsEnabled = false;
    const off = await upload(t);
    assert.equal(off.status, 503);
    assert.equal((await off.json()).error.code, 'uploads_paused');

    t.control.uploadsEnabled = true;
    t.control.fail = true;
    const unreachable = await upload(t);
    assert.equal(unreachable.status, 503);
    assert.equal((await unreachable.json()).error.code, 'uploads_paused');

    t.control.fail = false;
    assert.equal((await upload(t)).status, 201);
  } finally {
    t.cleanup();
  }
});

test('takedown purges the tag and shows the taken-down page', async () => {
  const t = setup();
  try {
    const json = await (await upload(t)).json();
    assert.deepEqual(await t.app.takedown(json.id), { outcome: 'ok', purged: true });
    assert.deepEqual(t.purged, [`plan-${json.id}`]);
    const page = await t.app.handle(new Request(json.url), { address: '198.51.100.9' });
    assert.equal(page.status, 410);
    assert.match(await page.text(), /planny took this plan down\./);
  } finally {
    t.cleanup();
  }
});

test('expired plans are swept through the Upstash range query, and their files go', async () => {
  const t = setup();
  try {
    const json = await (await upload(t, { duration: '1h' })).json();
    t.clock.t += 2 * 3600e3;
    const results = await t.app.sweep();
    assert.equal(results.find((result) => result.id === json.id)?.outcome, 'ok');
    assert.equal(t.blob.files.has(`plans/${json.id}.html`), false);
  } finally {
    t.cleanup();
  }
});

test('a purge refused for rate limits is retried', async () => {
  let calls = 0;
  const store = createVercelStore({
    env: {},
    client: fakeUpstash(mkdtempSync(join(tmpdir(), 'planny-purge-'))),
    blob: fakeBlob(),
    readConfig: async () => true,
    purge: async (tag) => {
      calls += 1;
      assert.equal(tag, 'plan-x');
      if (calls === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
    },
  });
  await store.purge('x');
  assert.equal(calls, 2);
});

test('a blob that is already gone does not block removal', async () => {
  const store = createVercelStore({
    env: {},
    client: fakeUpstash(mkdtempSync(join(tmpdir(), 'planny-gone-'))),
    blob: { ...fakeBlob(), async del() { throw Object.assign(new Error('no such blob'), { name: 'BlobNotFoundError' }); } },
    readConfig: async () => true,
    purge: async () => {},
  });
  await store.blobs.remove('00000000-0000-4000-8000-000000000000');
});
