import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createLuaRunner } from '../src/stores/lua-runner.js';
import { createMiniRedis } from '../src/stores/mini-redis.js';
import { createVercelStore } from '../src/stores/vercel.js';
import { createVercelApp } from '../src/vercel.js';

const ORIGIN = 'https://planny-pink.vercel.app';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><p onclick="x()">Hi</p></body></html>';

interface FakeClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  zrange(key: string, min: string, max: number, options: { byScore: true; offset: number; count: number }): Promise<string[]>;
}

function fakeUpstash(dir: string): FakeClient {
  const db = createMiniRedis({ file: join(dir, 'state.json') });
  const runner = createLuaRunner();
  return {
    eval: (script, keys, args) => db.transaction((run) => runner.run(script, keys, args, run)),
    hgetall: async (key) => db.transaction((run) => run('HGETALL', [key]) as Record<string, string>),
    zrange: (key, min, max, options) => {
      expect(min).toBe('-inf');
      expect(options.byScore).toBe(true);
      return db.transaction((run) => run('ZRANGEBYSCORE', [key, min, String(max), 'LIMIT', String(options.offset), String(options.count)]) as string[]);
    },
  };
}

function fakeBlob() {
  const files = new Map<string, Buffer>();
  return {
    files,
    async put(pathname: string, body: string | Uint8Array | Blob, options: { access: string; addRandomSuffix?: boolean }) {
      expect(options.access).toBe('private');
      expect(options.addRandomSuffix).toBe(false);
      const bytes = typeof body === 'string' ? Buffer.from(body) : body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : Buffer.from(body);
      files.set(pathname, bytes);
    },
    async get(pathname: string, options: { access: string }) {
      expect(options.access).toBe('private');
      const file = files.get(pathname);
      if (!file) return null;
      return { statusCode: 200, stream: new Blob([new Uint8Array(file)]).stream() as unknown as ReadableStream<Uint8Array> };
    },
    async del(pathname: string | string[]) {
      for (const name of Array.isArray(pathname) ? pathname : [pathname]) files.delete(name);
    },
  };
}

function setup(env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'planny-ts-glue-'));
  const clock = { t: Date.UTC(2026, 9, 19, 12) };
  const purged: string[] = [];
  const control = { uploadsEnabled: true, fail: false };
  const blob = fakeBlob();
  const app = createVercelApp({
    env: { PLANNY_ADDRESS_KEY: 'test-key', PLANNY_UPLOAD_SPACING_SECONDS: '0', ...env },
    client: fakeUpstash(dir),
    blob,
    now: () => clock.t,
    log: { error: () => {}, alert: () => {} },
    readConfig: async (key) => {
      if (control.fail) throw new Error('global config unreachable');
      return key === 'uploadsEnabled' ? control.uploadsEnabled : undefined;
    },
    purge: async (tag) => {
      purged.push(tag);
    },
  });
  return { app, blob, clock, control, purged };
}

const upload = (app: ReturnType<typeof createVercelApp>) => app.fetch(new Request(`${ORIGIN}/plans?name=Glue&duration=1h`, {
  method: 'POST',
  headers: { 'content-type': 'text/html' },
  body: PLAN,
}), { address: '198.51.100.9' });

const view = (app: ReturnType<typeof createVercelApp>, url: string) => app.fetch(new Request(url), { address: '198.51.100.9' });

test('the Vercel build stores HTML privately and serves it with the plan headers', async () => {
  const t = setup();
  const response = await upload(t.app);
  expect(response.status).toBe(201);
  const json = (await response.json()) as { id: string; url: string };
  expect(json.url.startsWith(`${ORIGIN}/p/`)).toBe(true);
  expect(t.blob.files.has(`plans/${json.id}.html`)).toBe(true);
  expect(t.blob.files.get(`plans/${json.id}.html`)?.toString()).not.toContain('onclick');
  const page = await view(t.app, json.url);
  expect(page.status).toBe(200);
  expect(page.headers.get('x-planny-build')).toBe('vercel');
  expect(page.headers.get('vercel-cache-tag')).toBe(`plan-${json.id}`);
  expect(await page.text()).not.toContain('LOCAL');
});

test('deleting purges the tag and the page is gone', async () => {
  const t = setup();
  const json = (await (await upload(t.app)).json()) as { id: string; url: string; deleteKey: string };
  const del = await t.app.fetch(new Request(json.url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${json.deleteKey}` },
  }), { address: '198.51.100.9' });
  expect(del.status).toBe(200);
  expect(t.purged).toEqual([`plan-${json.id}`]);
  expect((await view(t.app, json.url)).status).toBe(410);
});

test('the switch fails closed', async () => {
  const t = setup();
  t.control.uploadsEnabled = false;
  const off = await upload(t.app);
  expect(off.status).toBe(503);
  expect(((await off.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
  t.control.uploadsEnabled = true;
  t.control.fail = true;
  const unreachable = await upload(t.app);
  expect(unreachable.status).toBe(503);
  t.control.fail = false;
  expect((await upload(t.app)).status).toBe(201);
});

test('takedown, expiry and purge retries work through the Vercel store', async () => {
  const t = setup();
  const json = (await (await upload(t.app)).json()) as { id: string; url: string };
  expect(await t.app.takedown(json.id)).toEqual({ outcome: 'ok', purged: true });
  expect(t.purged).toEqual([`plan-${json.id}`]);
  const page = await view(t.app, json.url);
  expect(page.status).toBe(410);
  expect(await page.text()).toContain('planny took this plan down.');

  const second = (await (await upload(t.app)).json()) as { id: string; url: string };
  t.clock.t += 2 * 3600e3;
  const results = await t.app.sweep();
  expect(results.find((result) => result.id === second.id)?.outcome).toBe('ok');
  expect(t.blob.files.has(`plans/${second.id}.html`)).toBe(false);
});

test('a purge refused for rate limits is retried, and a missing blob does not block removal', async () => {
  let calls = 0;
  const store = createVercelStore({
    env: {},
    client: fakeUpstash(mkdtempSync(join(tmpdir(), 'planny-ts-purge-'))),
    blob: fakeBlob(),
    readConfig: async () => true,
    purge: async (tag) => {
      calls += 1;
      expect(tag).toBe('plan-x');
      if (calls === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
    },
  });
  await store.purge('x');
  expect(calls).toBe(2);

  const missing = createVercelStore({
    env: {},
    client: fakeUpstash(mkdtempSync(join(tmpdir(), 'planny-ts-gone-'))),
    blob: { ...fakeBlob(), del: async () => { throw Object.assign(new Error('no blob'), { name: 'BlobNotFoundError' }); } },
    readConfig: async () => true,
    purge: async () => {},
  });
  await missing.blobs.remove('00000000-0000-4000-8000-000000000000');
});
