import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/app.js';
import type { App } from '../src/app.js';
import { DAY_MS, HOUR_MS, loadConfig } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';

const ORIGIN = 'http://127.0.0.1:4319';
const ADDRESS = '203.0.113.21';
const HTML = '<!doctype html><html><head><title>Demo</title></head><body><h1>Demo plan</h1>'
  + '<script>alert(1)</script><p onclick="steal()">Body</p></body></html>';

interface Fixture {
  readonly app: App;
  readonly store: ReturnType<typeof createLocalStore>;
  readonly clock: { t: number };
  cleanup(): void;
}

function setup(env: Record<string, string> = {}, build: 'local' | 'vercel' = 'local'): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-demo-'));
  const clock = { t: Date.UTC(2026, 9, 24, 12) };
  const store = createLocalStore({ dataDir, now: () => clock.t });
  const app = createApp({
    build,
    store,
    config: { ...loadConfig(env), uploadSpacingSeconds: 0 },
    secret: 'test-secret',
    origin: ORIGIN,
    now: () => clock.t,
    log: { error: () => {}, alert: () => {} },
  });
  return { app, store, clock, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

const demo = (t: Fixture, address = ADDRESS, body = HTML) => t.app.fetch(new Request(`${ORIGIN}/demo/plans`, {
  method: 'POST',
  headers: { 'content-type': 'text/html; charset=utf-8' },
  body,
}), { address });

const publish = (t: Fixture, address = ADDRESS) => t.app.fetch(new Request(`${ORIGIN}/plans?name=Plan&duration=30d`, {
  method: 'POST',
  headers: { 'content-type': 'text/html' },
  body: '<!doctype html><html><body><p>Plan</p></body></html>',
}), { address });

test('the demo box publishes a plan with a fixed 24-hour life', async () => {
  const t = setup();
  try {
    const response = await demo(t);
    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      name: string;
      url: string;
      expiresAt: string;
      deleteKey: string;
      demo?: boolean;
      demoExpiresHours?: number;
      removed: Record<string, number>;
    };
    expect(body.demo).toBe(true);
    expect(body.demoExpiresHours).toBe(24);
    expect(body.name).toBe('Demo plan');
    expect(body.url).toBe(`${ORIGIN}/p/${body.id}`);
    expect(body.deleteKey.length).toBeGreaterThan(20);
    expect(new Date(body.expiresAt).getTime()).toBe(t.clock.t + DAY_MS);
    // The homepage is a real upload, so the sanitiser still runs on it.
    expect(body.removed['<script>']).toBeGreaterThan(0);
    expect(body.removed['event handler onclick']).toBeGreaterThan(0);

    const served = await t.app.fetch(new Request(`${ORIGIN}${new URL(body.url).pathname}`), { address: ADDRESS });
    expect(served.status).toBe(200);
    const html = await served.text();
    expect(html).toContain('Demo plan');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onclick');
  } finally {
    t.cleanup();
  }
});

test('a demo upload never spends the site-wide monthly upload budget', async () => {
  // No ordinary uploads are allowed at all, and the demo box still works: the two counters
  // are separate. This is the whole reason the demo has its own endpoint.
  const t = setup({ PLANNY_MONTHLY_UPLOADS: '0' });
  try {
    const blocked = await publish(t);
    expect(blocked.status).toBe(503);
    expect((await blocked.json() as { error: { code: string } }).error.code).toBe('site_upload_monthly_limit');

    const published = await demo(t);
    expect(published.status).toBe(201);
  } finally {
    t.cleanup();
  }
});

test('the demo quota is its own limit and reports itself', async () => {
  const t = setup({ PLANNY_DEMO_MONTHLY_UPLOADS: '1' });
  try {
    expect((await demo(t)).status).toBe(201);

    const second = await demo(t);
    expect(second.status).toBe(503);
    const body = await second.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('demo_upload_monthly_limit');
    // The message must not claim the API is paused, because it is not.
    expect(body.error.message).toContain('API is unaffected');

    // The ordinary API still works with the demo exhausted.
    expect((await publish(t)).status).toBe(201);
  } finally {
    t.cleanup();
  }
});

test('the demo box rejects the wrong method and the wrong content type', async () => {
  const t = setup();
  try {
    const get = await t.app.fetch(new Request(`${ORIGIN}/demo/plans`), { address: ADDRESS });
    expect(get.status).toBe(405);
    const wrongType = await t.app.fetch(new Request(`${ORIGIN}/demo/plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), { address: ADDRESS });
    expect(wrongType.status).toBe(415);
  } finally {
    t.cleanup();
  }
});

test('demo errors are JSON, not the HTML error page', async () => {
  const t = setup({ PLANNY_DEMO_MONTHLY_UPLOADS: '0' });
  try {
    const response = await demo(t);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
  } finally {
    t.cleanup();
  }
});

test('outbound links carry their surface in a ref parameter', async () => {
  const t = setup();
  try {
    const published = await demo(t);
    const id = (await published.json() as { id: string }).id;
    const plan = await (await t.app.fetch(new Request(`${ORIGIN}/p/${id}`), { address: ADDRESS })).text();
    expect(plan).toContain('https://use-planny.vercel.app?ref=plan');

    const sample = await (await t.app.fetch(new Request(`${ORIGIN}/sample`), { address: ADDRESS })).text();
    expect(sample).toContain('https://use-planny.vercel.app?ref=sample');

    const home = await (await t.app.fetch(new Request(`${ORIGIN}/`), { address: ADDRESS })).text();
    expect(home).toContain('https://github.com/frasergriffiths/planny?ref=site');

    const missing = await t.app.fetch(new Request(`${ORIGIN}/p/00000000-0000-4000-8000-000000000000`), { address: ADDRESS });
    const missingHtml = await missing.text();
    expect(missingHtml).toContain('https://use-planny.vercel.app?ref=missing');
  } finally {
    t.cleanup();
  }
});

test('a stale expiry is not extended by a demo upload', async () => {
  const t = setup();
  try {
    const body = await (await demo(t)).json() as { id: string; expiresAt: string };
    t.clock.t += DAY_MS + HOUR_MS;
    const response = await t.app.fetch(new Request(`${ORIGIN}/p/${body.id}`), { address: ADDRESS });
    expect(response.status).toBe(410);
  } finally {
    t.cleanup();
  }
});
