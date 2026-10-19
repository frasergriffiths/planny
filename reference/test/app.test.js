import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, MiB } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';
import { newClaimId, newPlanId } from '../src/util.js';

const ORIGIN = 'http://127.0.0.1:4317';
const ADDRESS = '203.0.113.7';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><h1>Hello</h1><p>Body</p></body></html>';
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-app-'));
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
  return { app, store, config, clock, logs, dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

async function upload(t, { name = 'Plan', duration = '30d', body = PLAN, type = 'text/html', ip = ADDRESS } = {}) {
  const query = new URLSearchParams({ name });
  if (duration !== null) query.set('duration', duration);
  const headers = type ? { 'content-type': type } : {};
  return t.app.handle(new Request(`${ORIGIN}/plans?${query}`, { method: 'POST', headers, body }), { address: ip });
}

async function uploaded(t, options) {
  const response = await upload(t, options);
  assert.equal(response.status, 201);
  return response.json();
}

const view = (t, url, { method = 'GET', ip = ADDRESS } = {}) => t.app.handle(
  new Request(`${ORIGIN}${new URL(url).pathname}`, { method }),
  { address: ip },
);

const remove = (t, id, key) => t.app.handle(
  new Request(`${ORIGIN}/p/${id}`, { method: 'DELETE', headers: key ? { authorization: `Bearer ${key}` } : {} }),
  { address: ADDRESS },
);

const counter = (t, key) => t.store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []).then(Number);

const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1];

test('every page type names planny in its title', async () => {
  const t = setup();
  try {
    const home = await t.app.handle(new Request(`${ORIGIN}/`), { address: ADDRESS });
    assert.equal(home.status, 200);
    assert.match(titleOf(await home.text()), /planny$/);

    const unknown = await t.app.handle(new Request(`${ORIGIN}/nowhere`), { address: ADDRESS });
    assert.equal(unknown.status, 404);
    assert.match(titleOf(await unknown.text()), /planny$/);

    const malformed = await view(t, `${ORIGIN}/p/not-a-plan`);
    assert.equal(malformed.status, 404);
    assert.match(titleOf(await malformed.text()), /planny$/);

    const expiring = await uploaded(t, { duration: '1h' });
    t.clock.t += 2 * 3600e3;
    const expired = await view(t, expiring.url);
    assert.equal(expired.status, 410);
    assert.match(titleOf(await expired.text()), /planny$/);

    const deletedPlan = await uploaded(t);
    assert.equal((await remove(t, deletedPlan.id, deletedPlan.deleteKey)).status, 200);
    const deleted = await view(t, deletedPlan.url);
    assert.equal(deleted.status, 410);
    assert.match(titleOf(await deleted.text()), /planny$/);

    const takenDown = await uploaded(t);
    await t.app.takedown(takenDown.id);
    const down = await view(t, takenDown.url);
    assert.equal(down.status, 410);
    assert.match(titleOf(await down.text()), /planny$/);

    const broken = await uploaded(t);
    rmSync(join(t.dataDir, 'plans', `${broken.id}.html`));
    const server = await view(t, broken.url);
    assert.equal(server.status, 500);
    assert.match(titleOf(await server.text()), /planny$/);
    t.logs.length = 0;

    const plan = await uploaded(t);
    t.config.monthly.reads = 0;
    const paused = await view(t, plan.url);
    const pausedHtml = await paused.text();
    assert.equal(paused.status, 503);
    assert.match(pausedHtml, /planny is paused until/);
    assert.match(titleOf(pausedHtml), /planny$/);
    t.config.monthly.reads = 8000;

    t.config.rateLimits.views = { max: 0, windowSeconds: 60 };
    const slow = await view(t, plan.url);
    assert.equal(slow.status, 429);
    assert.match(titleOf(await slow.text()), /planny$/);
    assert.ok(slow.headers.get('retry-after'));
    t.config.rateLimits.views = { max: 600, windowSeconds: 60 };

    const local = await view(t, plan.url);
    assert.match(titleOf(await local.text()), /^LOCAL · .+ \| planny$/);
  } finally {
    t.cleanup();
  }
});

test('bad uploads get their own status and a clear code', async () => {
  const t = setup();
  try {
    const cases = [
      [await upload(t, { type: 'text/plain' }), 415, 'unsupported_type'],
      [await upload(t, { name: '' }), 400, 'name_required'],
      [await upload(t, { duration: '0h' }), 400, 'duration_too_short'],
      [await upload(t, { duration: '101y' }), 400, 'duration_too_long'],
      [await upload(t, { duration: 'forever' }), 400, 'invalid_duration'],
      [await upload(t, { body: '' }), 400, 'empty_body'],
      [await upload(t, { body: new Uint8Array([0xff, 0xfe, 0x3c]) }), 400, 'invalid_encoding'],
      [await upload(t, { body: 'x'.repeat(4 * MiB + 1) }), 413, 'too_large'],
    ];
    for (const [response, status, code] of cases) {
      assert.equal(response.status, status, code);
      assert.equal((await response.json()).error.code, code);
    }
  } finally {
    t.cleanup();
  }
});

test('a plan streamed past 4 MB is refused even without a length', async () => {
  const t = setup();
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * MiB + 1));
        controller.close();
      },
    });
    const query = new URLSearchParams({ name: 'Streamed' });
    const response = await t.app.handle(new Request(`${ORIGIN}/plans?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body: stream,
      duplex: 'half',
    }), { address: ADDRESS });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'too_large');
  } finally {
    t.cleanup();
  }
});

test('the plan is cleaned before it is stored, and the reply says what went', async () => {
  const t = setup();
  try {
    const hostile = '<!doctype html><html><head><title>X</title><script>alert(1)</script></head>'
      + '<body><a href="https://evil.example">go</a><p onclick="x()">hi</p>'
      + '<form action="https://evil.example"><input></form></body></html>';
    const json = await uploaded(t, { body: hostile });
    assert.equal(json.removed['<script>'], 1);
    assert.equal(json.removed['link <a>'], 1);
    const page = await view(t, json.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const bad of ['<script', 'href=', 'onclick', '<form', '<input']) {
      assert.ok(!html.includes(bad), `${bad} reached the page`);
    }
    assert.match(html, /LOCAL · X \| planny/);
    assert.deepEqual(t.logs, []);
  } finally {
    t.cleanup();
  }
});

test('plan pages carry the sandbox, no-referrer and cache headers, and errors are not cached', async () => {
  const t = setup();
  try {
    const json = await uploaded(t, { duration: '1h' });
    const page = await view(t, json.url);
    assert.match(page.headers.get('content-security-policy'), /^sandbox; default-src 'none'/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'public, max-age=0, s-maxage=300, must-revalidate');
    assert.equal(page.headers.get('vercel-cdn-cache-control'), 's-maxage=300');
    assert.equal(page.headers.get('vercel-cache-tag'), `plan-${json.id}`);

    t.clock.t += 3600e3 - 120e3;
    const near = await view(t, json.url);
    assert.equal(near.headers.get('vercel-cdn-cache-control'), 's-maxage=120');

    const missing = await view(t, `${ORIGIN}/p/00000000-0000-4000-8000-000000000000`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(missing.headers.get('vercel-cdn-cache-control'), null);
  } finally {
    t.cleanup();
  }
});

test('the delete key removes a plan once, and only the right key works', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    assert.equal((await remove(t, json.id, null)).status, 401);
    assert.equal((await remove(t, json.id, 'nope')).status, 403);
    assert.equal((await remove(t, json.id, json.deleteKey)).status, 200);
    const again = await remove(t, json.id, json.deleteKey);
    assert.equal(again.status, 410);
    assert.equal((await again.json()).error.code, 'already_removed');
    const page = await view(t, json.url);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /The author deleted this plan\./);
    assert.equal(await t.store.blobs.get(json.id), null);
    assert.equal(await counter(t, 'planny:site:bytes'), 0);
  } finally {
    t.cleanup();
  }
});

test('expired plans show the expired page, and their bytes come back', async () => {
  const t = setup();
  try {
    const json = await uploaded(t, { duration: '1h' });
    t.clock.t += 61 * 60e3;
    const page = await view(t, json.url);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /This plan has expired\./);
    await flush();
    assert.equal(await t.store.blobs.get(json.id), null);
    assert.equal(await counter(t, 'planny:site:bytes'), 0);
    assert.equal((await t.app.records.get(json.id)).state, 'gone');
    assert.deepEqual(t.logs, []);
  } finally {
    t.cleanup();
  }
});

test('a crashed upload is swept, and its bytes come back', async () => {
  const t = setup();
  try {
    const id = newPlanId();
    await t.app.records.reserve({
      id,
      claimId: newClaimId(),
      now: t.clock.t,
      owner: 'crashed-owner',
      bytes: 1000,
      name: 'Crash',
      expiresAt: t.clock.t + 1e9,
      deleteKeyHash: 'unused',
      limits: { site: 1e9, owner: 1e9, monthlyUploads: 100 },
    });
    await t.store.blobs.put(id, new TextEncoder().encode('partial'));
    assert.equal(await counter(t, 'planny:site:bytes'), 1000);

    t.clock.t += 16 * 60e3;
    const results = await t.app.sweep();
    const swept = results.find((result) => result.id === id);
    assert.equal(swept.reason, 'abandoned');
    assert.equal(swept.outcome, 'ok');
    assert.equal((await t.app.records.get(id)).state, 'gone');
    assert.equal(await counter(t, 'planny:site:bytes'), 0);
    assert.equal(await t.store.blobs.get(id), null);
    assert.equal((await view(t, `${ORIGIN}/p/${id}`)).status, 404);
  } finally {
    t.cleanup();
  }
});

test('takedown removes the bytes and shows the taken-down page', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    assert.deepEqual(await t.app.takedown(json.id), { outcome: 'ok', purged: true });
    const page = await view(t, json.url);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /planny took this plan down\./);
    assert.equal(await t.store.blobs.get(json.id), null);
  } finally {
    t.cleanup();
  }
});

test('the site budget, the address budget and the monthly upload limit each refuse with their own code', async () => {
  const t = setup();
  try {
    assert.equal((await upload(t)).status, 201);
    t.config.siteStoredBytes = 1;
    const site = await upload(t);
    assert.equal(site.status, 503);
    assert.equal((await site.json()).error.code, 'storage_full');
    t.config.siteStoredBytes = 800 * MiB;

    t.config.ownerStoredBytes = 1;
    const owner = await upload(t);
    assert.equal(owner.status, 429);
    assert.equal((await owner.json()).error.code, 'storage_limit');
    t.config.ownerStoredBytes = 40 * MiB;

    t.config.monthly.uploads = 1;
    const monthly = await upload(t);
    assert.equal(monthly.status, 503);
    assert.equal((await monthly.json()).error.code, 'uploads_monthly_limit');
    t.config.monthly.uploads = 1500;
  } finally {
    t.cleanup();
  }
});

test('the upload rate limit, the kill switch and the view rate limit each hold', async () => {
  const t = setup();
  try {
    t.config.rateLimits.uploads = { max: 1, windowSeconds: 3600 };
    const first = await uploaded(t);
    const limited = await upload(t);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'rate_limited');
    assert.ok(limited.headers.get('retry-after'));
    t.config.rateLimits.uploads = { max: 20, windowSeconds: 3600 };

    await t.store.control.setUploadsEnabled(false);
    const paused = await upload(t);
    assert.equal(paused.status, 503);
    assert.equal((await paused.json()).error.code, 'uploads_paused');
    const reading = await view(t, first.url);
    assert.equal(reading.status, 200);
    await t.store.control.setUploadsEnabled(true);
    assert.equal((await upload(t)).status, 201);

    t.clock.t += 61e3;
    t.config.rateLimits.views = { max: 1, windowSeconds: 60 };
    assert.equal((await view(t, first.url)).status, 200);
    const slow = await view(t, first.url);
    assert.equal(slow.status, 429);
    assert.ok(slow.headers.get('retry-after'));
    t.config.rateLimits.views = { max: 600, windowSeconds: 60 };
  } finally {
    t.cleanup();
  }
});

test('the home page, HEAD, the method check and the name cleanup', async () => {
  const t = setup();
  try {
    const home = await t.app.handle(new Request(`${ORIGIN}/`), { address: ADDRESS });
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /style-src 'self'/);
    assert.match(await home.text(), /4 MiB \(4,194,304 bytes\) per plan/);

    const json = await uploaded(t, { name: '  Q4 \n rollout  ' });
    assert.equal(json.name, 'Q4 rollout');
    const head = await view(t, json.url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const put = await t.app.handle(new Request(`${ORIGIN}/plans`, { method: 'PUT' }), { address: ADDRESS });
    assert.equal(put.status, 405);
    assert.equal((await put.json()).error.code, 'method_not_allowed');
  } finally {
    t.cleanup();
  }
});

test('a plan record with no file gets the server error page, and the error is logged', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    rmSync(join(t.dataDir, 'plans', `${json.id}.html`));
    const page = await view(t, json.url);
    assert.equal(page.status, 500);
    assert.match(await page.text(), /could not be loaded/);
    assert.equal(t.logs.length, 1);
  } finally {
    t.cleanup();
  }
});
