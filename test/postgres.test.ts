import { expect, test } from 'bun:test';
import { createPostgresStore, type PostgresClient } from '../src/stores/postgres.js';
import { createVercelApp } from '../src/vercel.js';

const EMPTY = JSON.stringify({ strings: {}, hashes: {}, zsets: {}, expires: {} });

function fakePostgres() {
  const state = { value: EMPTY, seq: 0 };
  const plans = new Map<string, Uint8Array>();
  let enabled = true;
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  const client: PostgresClient = {
    async query<T>(text: string, params: unknown[] = []) {
      const sql = normalize(text);
      if (sql.startsWith('create table')) return { rows: [] as T[] };
      if (sql.startsWith('insert into planny_state')) return { rows: [] as T[] };
      if (sql.startsWith('insert into planny_control')) {
        if (params.length > 0) enabled = params[0] === true;
        return { rows: [] as T[] };
      }
      if (sql.startsWith('select value, seq from planny_state')) {
        return { rows: [{ value: state.value, seq: state.seq }] as T[] };
      }
      if (sql.startsWith('update planny_state')) {
        state.value = String(params[0]);
        state.seq = Number(params[1]);
        return { rows: [] as T[] };
      }
      if (sql.startsWith('select enabled from planny_control')) {
        return { rows: [{ enabled }] as T[] };
      }
      if (sql.startsWith('insert into planny_plans')) {
        const id = String(params[0]);
        if (plans.has(id)) return { rows: [] as T[] };
        plans.set(id, params[1] as Uint8Array);
        return { rows: [{ id }] as T[] };
      }
      if (sql.startsWith('select html from planny_plans')) {
        const html = plans.get(String(params[0]));
        return { rows: (html ? [{ html }] : []) as T[] };
      }
      if (sql.startsWith('delete from planny_plans')) {
        plans.delete(String(params[0]));
        return { rows: [] as T[] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async transaction<T>(work: (tx: PostgresClient) => Promise<T>) {
      return work(client);
    },
  };
  return { client, plans, state };
}

test('the postgres store keeps control state and plan bytes', async () => {
  const t = fakePostgres();
  const store = createPostgresStore({ client: t.client });
  expect(await store.control.uploadsEnabled()).toBe(true);
  await store.control.setUploadsEnabled(false);
  expect(await store.control.uploadsEnabled()).toBe(false);
  await store.control.setUploadsEnabled(true);
  expect(await store.control.uploadsEnabled()).toBe(true);

  const id = '6f2c7f7e-5f5e-4a1e-9f0a-1f6f2a9d8c11';
  const html = new TextEncoder().encode('<p>hello</p>');
  await store.blobs.put(id, html);
  expect(await store.blobs.get(id)).toEqual(html);
  await expect(store.blobs.put(id, html)).rejects.toThrow(/already exists/);
  await store.blobs.remove(id);
  expect(await store.blobs.get(id)).toBeNull();
});

test('the postgres store runs the shared state engine and bumps seq', async () => {
  const t = fakePostgres();
  const store = createPostgresStore({ client: t.client });
  await store.redis.eval("redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]); return 1", ['hash'], ['a', 'b']);
  expect(await store.redis.hgetall('hash')).toEqual({ a: 'b' });
  await store.redis.eval("redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2]); return 1", ['z'], ['5', 'five']);
  expect(await store.redis.zrangebyscore('z', 10, 5)).toEqual(['five']);
  const parsed = JSON.parse(t.state.value) as { seq?: number };
  expect(parsed.seq ?? 0).toBeGreaterThan(0);
  expect(t.state.seq).toBe(parsed.seq ?? 0);
});

test('PLANNY_STORE selects blob or postgres and rejects anything else', () => {
  const fake = fakePostgres();
  const base = { PLANNY_ADDRESS_KEY: 'addr', PLANNY_UPLOAD_SPACING_SECONDS: '0' };
  expect(() => createVercelApp({
    env: { ...base, PLANNY_STORE: 'postgres', DATABASE_URL: 'postgres://example' },
    postgresClient: fake.client,
    log: { error: () => {}, alert: () => {} },
  })).not.toThrow();
  expect(() => createVercelApp({
    env: { ...base, PLANNY_STORE: 'postgres' },
    postgresClient: fake.client,
    log: { error: () => {}, alert: () => {} },
  })).toThrow(/DATABASE_URL/);
  expect(() => createVercelApp({
    env: { PLANNY_STORE: 'postgres', DATABASE_URL: 'postgres://example' },
    postgresClient: fake.client,
    log: { error: () => {}, alert: () => {} },
  })).toThrow(/PLANNY_ADDRESS_KEY/);
  expect(() => createVercelApp({
    env: { ...base, PLANNY_STORE: 'mysql' },
    log: { error: () => {}, alert: () => {} },
  })).toThrow(/PLANNY_STORE/);
  // Blob stays the default and still needs its token.
  expect(() => createVercelApp({
    env: { PLANNY_ADDRESS_KEY: 'addr' },
    log: { error: () => {}, alert: () => {} },
  })).toThrow(/BLOB_READ_WRITE_TOKEN/);
});

test('the postgres app publishes and serves a plan without a Blob token', async () => {
  const fake = fakePostgres();
  const app = createVercelApp({
    env: {
      PLANNY_STORE: 'postgres',
      DATABASE_URL: 'postgres://example',
      PLANNY_ADDRESS_KEY: 'addr',
      PLANNY_UPLOAD_SPACING_SECONDS: '0',
    },
    postgresClient: fake.client,
    log: { error: () => {}, alert: () => {} },
    now: () => Date.UTC(2026, 9, 21, 12),
  });
  const response = await app.fetch(new Request('https://use-planny.vercel.app/plans?name=Neon&duration=1h', {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: '<html><body><h1>Neon</h1></body></html>',
  }), { address: '198.51.100.20' });
  expect(response.status).toBe(201);
  const json = (await response.json()) as { id: string; url: string };
  expect(fake.plans.has(json.id)).toBe(true);
  const page = await app.fetch(new Request(json.url), { address: '198.51.100.20' });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<h1>Neon</h1>');
});
