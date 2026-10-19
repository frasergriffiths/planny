import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/app.js';
import type { App, Logger } from '../src/app.js';
import { loadConfig, MiB, type AppConfig } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';

const ORIGIN = 'http://127.0.0.1:4317';
const ADDRESS = '203.0.113.7';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><h1>Hello</h1><p>Body</p></body></html>';
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

interface Fixture {
  readonly app: App;
  readonly store: ReturnType<typeof createLocalStore>;
  readonly config: AppConfig;
  readonly clock: { t: number };
  readonly logs: unknown[][];
  readonly alerts: Array<{ message: string; fields: Record<string, string | number> }>;
  readonly dataDir: string;
  cleanup(): void;
}

function setup(env: Record<string, string> = {}, overrides: Partial<AppConfig> = {}, start?: number): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-ts-app-'));
  const clock = { t: start ?? Date.UTC(2026, 9, 19, 12) };
  const logs: unknown[][] = [];
  const alerts: Array<{ message: string; fields: Record<string, string | number> }> = [];
  const store = createLocalStore({ dataDir, now: () => clock.t });
  const config: AppConfig = { ...loadConfig(env), uploadSpacingSeconds: 0, ...overrides };
  const log: Logger = {
    error: (...args) => logs.push(args),
    alert: (message, fields) => alerts.push({ message, fields }),
  };
  const app = createApp({
    build: 'local',
    store,
    config,
    secret: 'test-secret',
    origin: ORIGIN,
    adminToken: 'test-admin',
    now: () => clock.t,
    log,
  });
  return {
    app,
    store,
    config,
    clock,
    logs,
    alerts,
    dataDir,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

async function upload(
  t: Fixture,
  options: { name?: string; duration?: string; body?: string | Uint8Array; type?: string | null } = {},
): Promise<Response> {
  const query = new URLSearchParams({ name: options.name ?? 'Plan', duration: options.duration ?? '30d' });
  const headers: Record<string, string> = options.type === null ? {} : { 'content-type': options.type ?? 'text/html' };
  const body = options.body ?? PLAN;
  return t.app.fetch(new Request(`${ORIGIN}/plans?${query}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : new Blob([body as Uint8Array<ArrayBuffer>]),
  }), { address: ADDRESS });
}

async function uploaded(t: Fixture, options: Parameters<typeof upload>[1] = {}) {
  const response = await upload(t, options);
  expect(response.status).toBe(201);
  return response.json() as Promise<{
    id: string;
    name: string;
    url: string;
    bytes: number;
    deleteKey: string;
    removed: Record<string, number>;
  }>;
}

const view = (t: Fixture, url: string, init: RequestInit = {}) => t.app.fetch(
  new Request(`${ORIGIN}${new URL(url).pathname}${new URL(url).search}`, init),
  { address: ADDRESS },
);

const remove = (t: Fixture, id: string, key?: string) => t.app.fetch(new Request(`${ORIGIN}/p/${id}`, {
  method: 'DELETE',
  ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
}), { address: ADDRESS });

const counter = (t: Fixture, key: string) => t.store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []).then(Number);
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';

test('the 4 MiB cap applies to the raw body, inclusive', async () => {
  const t = setup();
  try {
    const exact = `<p>${'x'.repeat(4 * MiB - 7)}</p>`;
    expect(Buffer.byteLength(exact)).toBe(4 * MiB);
    expect((await upload(t, { body: exact })).status).toBe(201);
    expect((await upload(t, { body: `${exact}x` })).status).toBe(413);
  } finally {
    t.cleanup();
  }
});

test('the home page and an unknown path render, and every page names planny', async () => {
  const t = setup();
  try {
    const home = await t.app.fetch(new Request(`${ORIGIN}/`), { address: ADDRESS });
    expect(home.status).toBe(200);
    expect(titleOf(await home.text())).toMatch(/planny$/);
    const unknown = await t.app.fetch(new Request(`${ORIGIN}/nowhere`), { address: ADDRESS });
    expect(unknown.status).toBe(404);
    expect(titleOf(await unknown.text())).toMatch(/planny$/);
    const missing = await view(t, `${ORIGIN}/p/00000000-0000-4000-8000-000000000000`);
    expect(missing.status).toBe(404);
  } finally {
    t.cleanup();
  }
});

test('bad uploads get their own status and code', async () => {
  const t = setup();
  try {
    const cases: Array<[Response, number, string]> = [
      [await upload(t, { type: 'text/plain' }), 415, 'unsupported_type'],
      [await upload(t, { name: '' }), 400, 'name_required'],
      [await upload(t, { duration: '0h' }), 400, 'duration_too_short'],
      [await upload(t, { duration: '101y' }), 400, 'duration_too_long'],
      [await upload(t, { duration: 'forever' }), 400, 'invalid_duration'],
      [await upload(t, { body: '' }), 400, 'empty_body'],
      [await upload(t, { body: new Uint8Array([0xff, 0xfe, 0x3c]) }), 400, 'invalid_encoding'],
      [await upload(t, { body: 'x'.repeat(4 * MiB + 1) }), 413, 'too_large'],
      [await upload(t, { body: '<div>'.repeat(5000) }), 400, 'too_deep'],
    ];
    for (const [response, status, code] of cases) {
      expect(response.status).toBe(status);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    }
  } finally {
    t.cleanup();
  }
});

test('an upload is cleaned, stored and served with the plan headers', async () => {
  const t = setup();
  try {
    const hostile = '<html><head><title>X</title><script>alert(1)</script></head>'
      + '<body><a href="https://evil.example">go</a><p onclick="x()">hi</p></body></html>';
    const json = await uploaded(t, { body: hostile });
    expect(json.removed['<script>']).toBe(1);
    expect(json.removed['link <a>']).toBe(1);
    const page = await view(t, json.url);
    expect(page.status).toBe(200);
    const raw = await t.app.fetch(new Request(json.url), { address: ADDRESS });
    const rawBody = await raw.text();
    for (const bad of ['<script', 'href=', 'onclick']) expect(rawBody).not.toContain(bad);
    expect(rawBody).toContain('<title>X</title>');
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600, must-revalidate');
    expect(page.headers.get('vercel-cdn-cache-control')).toBe('s-maxage=3600');
    expect(page.headers.get('vercel-cache-tag')).toBe(`plan-${json.id}`);
    expect(t.logs).toEqual([]);
  } finally {
    t.cleanup();
  }
});

test('query strings are a 404 and do not count as reads', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    expect((await view(t, `${json.url}?x=1`)).status).toBe(404);
    expect(await counter(t, 'planny:month:2026-10:reads')).toBe(0);
    expect((await view(t, json.url)).status).toBe(200);
    expect(await counter(t, 'planny:month:2026-10:reads')).toBe(1);
  } finally {
    t.cleanup();
  }
});

test('the delete key removes a plan once, and only the right key works', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    expect((await remove(t, json.id)).status).toBe(401);
    expect((await remove(t, json.id, 'nope')).status).toBe(403);
    expect((await remove(t, json.id, json.deleteKey)).status).toBe(200);
    expect((await remove(t, json.id, json.deleteKey)).status).toBe(410);
    const page = await view(t, json.url);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain('The author deleted this plan.');
    expect(await counter(t, 'planny:site:bytes')).toBe(0);
  } finally {
    t.cleanup();
  }
});

test('expiry returns the bytes, and a failed blob delete waits for the sweep', async () => {
  const t = setup();
  try {
    const short = await uploaded(t, { duration: '1h' });
    t.clock.t += 61 * 60e3;
    expect((await view(t, short.url)).status).toBe(410);
    await flush();
    expect(await counter(t, 'planny:site:bytes')).toBe(0);

    const json = await uploaded(t);
    const original = t.store.blobs.remove.bind(t.store.blobs);
    let failures = 1;
    t.store.blobs.remove = async (id: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('storage unavailable');
      }
      return original(id);
    };
    expect((await remove(t, json.id, json.deleteKey)).status).toBe(200);
    expect(await counter(t, 'planny:site:bytes')).toBeGreaterThan(0);
    t.clock.t += 16 * 60e3;
    const results = await t.app.sweep();
    expect(results.find((result) => result.id === json.id)?.outcome).toBe('ok');
    expect(await counter(t, 'planny:site:bytes')).toBe(0);
  } finally {
    t.cleanup();
  }
});

test('the upload rate limit, the switch and the view rate limit hold', async () => {
  const t = setup();
  try {
    t.config.uploadSpacingSeconds = 120;
    await uploaded(t);
    const limited = await upload(t);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('address_upload_rate_limited');
    expect(limited.headers.get('retry-after')).toBeTruthy();
    t.config.uploadSpacingSeconds = 0;

    await t.store.control.setUploadsEnabled(false);
    const paused = await upload(t);
    expect(paused.status).toBe(503);
    expect(((await paused.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
    await t.store.control.setUploadsEnabled(true);
    expect((await upload(t)).status).toBe(201);

    t.clock.t += 61e3;
    t.config.rateLimits.views.max = 1;
    const json = await uploaded(t);
    expect((await view(t, json.url)).status).toBe(200);
    expect((await view(t, json.url)).status).toBe(429);
  } finally {
    t.cleanup();
  }
});

test('the read guard pauses views, deletes still work, and the admin reset frees them', async () => {
  const t = setup({ PLANNY_MONTHLY_READS: '0' });
  try {
    const json = await uploaded(t);
    const paused = await view(t, json.url);
    expect(paused.status).toBe(503);
    const body = await paused.text();
    expect(body).toContain('New plan reads are paused.');
    expect(body).toContain('Deletes and takedowns still work.');
    expect(paused.headers.get('cache-control')).toBe('no-store');
    expect(paused.headers.get('vercel-cdn-cache-control')).toBeNull();

    const reset = await t.app.fetch(new Request(`${ORIGIN}/admin/reset`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-admin', 'content-type': 'application/json' },
      body: JSON.stringify({ counter: 'reads' }),
    }), { address: ADDRESS });
    expect(reset.status).toBe(200);
    t.config.monthly.reads = 100;
    expect((await view(t, json.url)).status).toBe(200);
    expect((await remove(t, json.id, json.deleteKey)).status).toBe(200);
  } finally {
    t.cleanup();
  }
});

test('the per-plan and monthly alerts are logged once', async () => {
  const t = setup({}, {
    monthly: { uploads: 5000, reads: 1_500_000, readBytes: 1_000_000_000 },
    planReadAlert: { perPlanHourly: 0, monthlyWarningFraction: 0.0000001, counterTtlSeconds: 7200 },
  }, Date.UTC(2027, 0, 3, 9, 30));
  try {
    const json = await uploaded(t);
    expect((await view(t, json.url)).status).toBe(200);
    expect((await view(t, json.url)).status).toBe(200);
    expect(t.alerts.some((alert) => alert.fields.plan === json.id)).toBe(true);
    expect(t.alerts.some((alert) => alert.message.includes('half of the monthly read budget'))).toBe(true);
  } finally {
    t.cleanup();
  }
});
