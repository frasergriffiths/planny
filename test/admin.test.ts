import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/app.js';
import type { App, Logger } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLocalStore } from '../src/stores/local.js';
import { ownerKey } from '../src/util.js';

const ORIGIN = 'http://127.0.0.1:4317';
const ADDRESS = '203.0.113.7';
const PLAN = '<html><head><title>Admin</title></head><body><p>x</p></body></html>';

interface Setup {
  readonly app: App;
  readonly alerts: Array<{ message: string; fields: Record<string, string | number> }>;
  readonly clock: { t: number };
  readonly config: ReturnType<typeof loadConfig>;
  cleanup(): void;
}

function setup(env: Record<string, string> = {}, start = Date.UTC(2027, 1, 2, 8), share?: number): Setup {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-admin-'));
  const clock = { t: start };
  const alerts: Array<{ message: string; fields: Record<string, string | number> }> = [];
  const store = createLocalStore({ dataDir, now: () => clock.t });
  const log: Logger = { error: () => {}, alert: (message, fields) => alerts.push({ message, fields }) };
  const config = loadConfig(env);
  if (share !== undefined) config.ownerMonthlyReadBytes = share;
  const app = createApp({
    build: 'local',
    store,
    config,
    secret: 'test-secret',
    origin: ORIGIN,
    adminToken: 'admin-secret',
    now: () => clock.t,
    log,
  });
  return { app, alerts, clock, config, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

const upload = (app: App) => app.fetch(new Request(`${ORIGIN}/plans?name=Admin&duration=1d`, {
  method: 'POST',
  headers: { 'content-type': 'text/html' },
  body: PLAN,
}), { address: ADDRESS });

const view = (app: App, url: string) => app.fetch(new Request(`${ORIGIN}${new URL(url).pathname}`), { address: ADDRESS });

const admin = (app: App, path: string, body: unknown, token = 'admin-secret') => app.fetch(new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}), { address: ADDRESS });

test('admin calls are audited, the token never is, and wrong tokens are rate limited too', async () => {
  const t = setup();
  try {
    const json = (await (await upload(t.app)).json()) as { id: string; url: string };
    expect((await admin(t.app, `/admin/plans/${json.id}/remove`, {})).status).toBe(200);
    expect(t.alerts.some((alert) => alert.fields.action === 'takedown' && alert.fields.plan === json.id && alert.fields.outcome === 'ok')).toBe(true);
    expect(JSON.stringify(t.alerts)).not.toContain('admin-secret');

    const wrong = await admin(t.app, '/admin/reset', { counter: 'reads' }, 'wrong-token');
    expect(wrong.status).toBe(401);
    expect(t.alerts.some((alert) => alert.fields.action === 'reset' && alert.fields.outcome === 'unauthorized')).toBe(true);

    // The limit applies before the token check: ten calls had already passed (one takedown, one
    // reset attempt, and eight more here), so the twelfth is refused with 429 even with no token.
    for (let index = 0; index < 9; index += 1) {
      await admin(t.app, '/admin/reset', { counter: 'reads' }, 'wrong-token');
    }
    const limited = await admin(t.app, '/admin/reset', { counter: 'reads' }, 'wrong-token');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await view(t.app, json.url)).status).toBe(410);
  } finally {
    t.cleanup();
  }
});

test('a site read reset lets views through again, and the counter is really cleared', async () => {
  const t = setup({ PLANNY_MONTHLY_READS: '1' });
  try {
    const json = (await (await upload(t.app)).json()) as { id: string; url: string };
    expect((await view(t.app, json.url)).status).toBe(200);
    expect((await view(t.app, json.url)).status).toBe(503);
    const reset = await admin(t.app, '/admin/reset', { counter: 'reads' });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { before: { reads: number } }).before.reads).toBe(1);
    expect((await view(t.app, json.url)).status).toBe(200);
  } finally {
    t.cleanup();
  }
});

test('an address-scoped reset clears that address read share and the monthly warning marker', async () => {
  const t = setup({ PLANNY_MONTHLY_READS: '1000' });
  try {
    const json = (await (await upload(t.app)).json()) as { id: string; url: string; bytes: number };
    t.config.ownerMonthlyReadBytes = json.bytes;
    expect((await view(t.app, json.url)).status).toBe(200);
    expect((await view(t.app, json.url)).status).toBe(503);
    const owner = ownerKey('test-secret', ADDRESS);
    const reset = await admin(t.app, '/admin/reset', { counter: 'owner', owner });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { reset: string }).reset).toBe('owner');
    expect((await view(t.app, json.url)).status).toBe(200);
  } finally {
    t.cleanup();
  }
});

test('the owner reset needs the hashed address', async () => {
  const t = setup();
  try {
    const response = await admin(t.app, '/admin/reset', { counter: 'owner' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('invalid_reset');
  } finally {
    t.cleanup();
  }
});

test('the upload switch is reachable through the App interface locally', async () => {
  const t = setup();
  try {
    expect(await t.app.uploadsEnabled()).toBe(true);
    await t.app.setUploadsEnabled(false);
    expect(await t.app.uploadsEnabled()).toBe(false);
    const paused = await upload(t.app);
    expect(paused.status).toBe(503);
    expect(((await paused.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
    await t.app.setUploadsEnabled(true);
    expect((await upload(t.app)).status).toBe(201);
  } finally {
    t.cleanup();
  }
});
