import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { newPlanId } from '../src/util.js';
import { createApp } from '../src/app.js';
import type { App, Logger } from '../src/app.js';
import { loadConfig, MiB, type AppConfig } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';
import { PLAN_SCRIPT, PLAN_SCRIPT_HASH } from '../src/plan-script.js';

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
    for (const bad of ['alert(1)', 'href=', 'onclick']) expect(rawBody).not.toContain(bad);
    expect(rawBody.split('<script>').length - 1).toBe(1);
    expect(rawBody).toContain('<title>X</title>');
    expect(page.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600, must-revalidate');
    expect(page.headers.get('vercel-cdn-cache-control')).toBe('s-maxage=3600');
    expect(page.headers.get('vercel-cache-tag')).toBe(`plan-${json.id}`);
    expect(t.logs).toEqual([]);
  } finally {
    t.cleanup();
  }
});


test('plan responses carry the trusted copy script once with a matching CSP hash', async () => {
  const t = setup();
  try {
    const json = await uploaded(t, { body: '<html><body><div class="code-block"><pre><code>x</code></pre></div></body></html>' });
    const response = await view(t, json.url);
    const body = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain(`script-src 'sha256-${PLAN_SCRIPT_HASH}'`);
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(body.split('<script>').length - 1).toBe(1);
    const open = body.indexOf('<script>') + '<script>'.length;
    const close = body.indexOf('</script>', open);
    const inline = body.slice(open, close);
    expect(inline).toBe(PLAN_SCRIPT);
    const digest = createHash('sha256').update(inline).digest('base64');
    expect(csp).toContain(`'sha256-${digest}'`);
  } finally {
    t.cleanup();
  }
});

test('site pages do not sandbox with allow-scripts and never carry the plan script', async () => {
  const t = setup();
  try {
    for (const path of ['/', '/nowhere', '/terms-of-use']) {
      const response = await t.app.fetch(new Request(`${ORIGIN}${path}`), { address: ADDRESS });
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).not.toContain('allow-scripts');
      expect(await response.text()).not.toContain(PLAN_SCRIPT_HASH);
    }
  } finally {
    t.cleanup();
  }
});


test('HEAD returns the plan headers with no body', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    const response = await view(t, json.url, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain(`script-src 'sha256-${PLAN_SCRIPT_HASH}'`);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain("'unsafe-eval'");
  } finally {
    t.cleanup();
  }
});

test('the sample gets allow-scripts and the same script hash', async () => {
  const t = setup();
  try {
    const response = await t.app.fetch(new Request(`${ORIGIN}/sample`), { address: ADDRESS });
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-top-navigation-by-user-activation allow-scripts');
    expect(csp).toContain(`script-src 'sha256-${PLAN_SCRIPT_HASH}'`);
    const body = await response.text();
    expect(body.split('<script>').length - 1).toBe(1);
    expect(body).toContain('Make your own plan');
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
    expect(t.alerts.filter((alert) => alert.fields.plan === json.id)).toHaveLength(1);
    expect(t.alerts.filter((alert) => alert.message.includes('half of the monthly read budget'))).toHaveLength(1);
    t.clock.t += 60 * 60e3 + 1; // a later hour is a fresh plan-alert window
    expect(t.alerts.filter((alert) => alert.fields.plan === json.id)).toHaveLength(1);
  } finally {
    t.cleanup();
  }
});

test('a failed blob put rolls the reservation back so uploads keep working', async () => {
  const t = setup();
  try {
    const realPut = t.store.blobs.put.bind(t.store.blobs);
    t.store.blobs.put = async () => {
      throw new Error('disk dead');
    };
    const failed = await upload(t);
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('upload_failed');
    expect(t.logs.some((args) => args[0] === 'planny: could not store the plan file')).toBe(true);

    // The reservation was released: no pending record and site bytes are back to 0.
    t.store.blobs.put = realPut;
    const counter = await t.store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", ['planny:site:bytes'], []);
    expect(Number(counter)).toBe(0);
    const pending = await (t.app as unknown as { records: { staleIds(staleBefore: number, limit: number): Promise<unknown[]> } }).records.staleIds(t.clock.t - 60_000, 20);
    expect(pending).toEqual([]);

    const next = await upload(t);
    expect(next.status).toBe(201);

    // Site bytes were also released: the quota senses only the stored plan.
    const second = await upload(t, { name: 'Second' });
    expect(second.status).toBe(201);
  } finally {
    t.cleanup();
  }
});

test('a store outage maps to 503 with retry-after on uploads and views', async () => {
  const t = setup();
  try {
    const realEval = t.store.redis.eval.bind(t.store.redis);
    const outage = async () => {
      throw new (await import('../src/stores/blob.js')).StoreUnavailableError();
    };
    t.store.redis.eval = outage;
    const down = await upload(t);
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('5');
    expect(((await down.json()) as { error: { code: string } }).error.code).toBe('store_unavailable');

    // Views are pages, so the same outage yields the paused HTML page.
    const viewDown = await t.app.fetch(new Request(`${ORIGIN}/p/00000000-0000-4000-8000-000000000001`), { address: ADDRESS });
    expect(viewDown.status).toBe(503);
    expect(viewDown.headers.get('retry-after')).toBe('5');
    expect(await viewDown.text()).toContain('New plan reads are paused');
    t.store.redis.eval = realEval;
  } finally {
    t.cleanup();
  }
});

test('app-level storage and upload limits map to the documented status and code', async () => {
  const cases = [
    { overrides: { siteBytes: 50 }, status: 503, code: 'storage_full' },
    { overrides: { ownerBytes: 50 }, status: 429, code: 'storage_limit' },
    { overrides: { monthly: { uploads: 0, reads: 1_500_000, readBytes: 200 * MiB } }, status: 503, code: 'site_upload_monthly_limit' },
    { overrides: { uploadsPerDay: 0 }, status: 429, code: 'address_upload_daily_limit' },
  ];
  for (const testCase of cases) {
    const t = setup({}, testCase.overrides);
    try {
      const response = await upload(t);
      expect(response.status, `${testCase.code}`).toBe(testCase.status);
      expect(((await response.json()) as { error: { code: string } }).error.code, `${testCase.code}`).toBe(testCase.code);
    } finally {
      t.cleanup();
    }
  }
});

test('upload validation and method handling cover the remaining cases', async () => {
  const t = setup();
  try {
    const tooLong = await upload(t, { name: 'x'.repeat(121) });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as { error: { code: string } }).error.code).toBe('name_too_long');

    // NOTE: an unknown query key is asserted below: querySchema is .strict(), so any
    // extra key is rejected with invalid_query per the documented contract.
    const unknown = await t.app.fetch(new Request(`${ORIGIN}/plans?name=A&duration=1h&x=1`, {
      method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN,
    }), { address: ADDRESS });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid_query');

    const getPlans = await t.app.fetch(new Request(`${ORIGIN}/plans`), { address: ADDRESS });
    expect(getPlans.status).toBe(405);
    expect(getPlans.headers.get('allow')).toBe('POST');

    const id = newPlanId();
    const put = await t.app.fetch(new Request(`${ORIGIN}/p/${id}`, { method: 'PUT' }), { address: ADDRESS });
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET, HEAD, DELETE');

    const headHome = await t.app.fetch(new Request(ORIGIN, { method: 'HEAD' }), { address: ADDRESS });
    expect(headHome.status).toBe(200);
    expect(headHome.headers.get('content-type')).toContain('text/html');
    expect((await headHome.arrayBuffer()).byteLength).toBe(0);

    const json = await uploaded(t);
    const headPlan = await t.app.fetch(new Request(json.url, { method: 'HEAD' }), { address: ADDRESS });
    expect(headPlan.status).toBe(200);
    expect(headPlan.headers.get('x-planny-build')).toBe('local');
    expect(headPlan.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600, must-revalidate');
    expect((await headPlan.arrayBuffer()).byteLength).toBe(0);
  } finally {
    t.cleanup();
  }
});

test('delete attempts are rate limited and concurrent removals answer 409 busy', async () => {
  const t = setup();
  try {
    // The delete limiter allows 60 attempts per hour; a lower limit makes the mapping testable.
    t.config.rateLimits.deletes = { max: 2, windowSeconds: 3600 };
    const json = await uploaded(t);
    t.config.rateLimits.deletes = { max: 1, windowSeconds: 3600 };
    expect((await remove(t, json.id, json.deleteKey)).status).toBe(200);

    const second = await uploaded(t, { name: 'Second' });
    const limited = await remove(t, second.id, second.deleteKey);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');

    // A concurrent removal loses the claim race: the second claimer answers 409 busy.
    const third = await uploaded(t, { name: 'Third' });
    t.clock.t += 3600e3; // reset the limiter window
    const records = (t.app as unknown as { records: { claim(): Promise<string> } }).records;
    const realClaim = records.claim;
    records.claim = async () => 'busy';
    const busy = await t.app.fetch(new Request(`${ORIGIN}/p/${third.id}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${third.deleteKey}` },
    }), { address: ADDRESS });
    records.claim = realClaim;
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe('busy');
  } finally {
    t.cleanup();
  }
});
