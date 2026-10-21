import { dangerouslyDeleteByTag } from '@vercel/functions';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { createLuaRunner } from './lua-runner.js';
import { createMiniRedis, type CommandFn } from './mini-redis.js';
import type { RedisLike, Store } from './local.js';
import { StoreUnavailableError } from './blob.js';

// The state engine expects a Redis-like surface over one JSON document. Postgres holds
// that document in a single locked row, so a transaction serialises the read-modify-write.
export interface PostgresClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(work: (tx: PostgresClient) => Promise<T>): Promise<T>;
}

const EMPTY_STATE = JSON.stringify({ strings: {}, hashes: {}, zsets: {}, expires: {} });

const SCHEMA = [
  `create table if not exists planny_state (
    id int primary key check (id = 1),
    value text not null,
    seq bigint not null default 0
  )`,
  `create table if not exists planny_plans (
    id uuid primary key,
    html bytea not null
  )`,
  `create table if not exists planny_control (
    id int primary key check (id = 1),
    enabled boolean not null
  )`,
];

export function createPostgresClient(url: string): PostgresClient {
  const sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  const wrap = (client: typeof sql): PostgresClient => ({
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, params as never[]);
      return { rows: rows as unknown as T[] };
    },
    transaction<T>(work: (tx: PostgresClient) => Promise<T>) {
      return sql.begin((tx) => work(wrap(tx as unknown as typeof sql))) as Promise<T>;
    },
  });
  return wrap(sql);
}

export function createPostgresStore({ client }: { client: PostgresClient }): Store {
  const runner = createLuaRunner();
  let ready: Promise<void> | null = null;

  function ensure(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        for (const statement of SCHEMA) await client.query(statement);
        await client.query('insert into planny_state (id, value, seq) values (1, $1, 0) on conflict (id) do nothing', [EMPTY_STATE]);
        await client.query('insert into planny_control (id, enabled) values (1, true) on conflict (id) do nothing');
      })().catch((error: unknown) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  }

  async function withState<T>(work: (file: string) => Promise<T>): Promise<T> {
    await ensure();
    const dir = mkdtempSync(join(tmpdir(), 'planny-postgres-'));
    const file = join(dir, 'state.json');
    try {
      return await client.transaction(async (tx) => {
        const { rows } = await tx.query<{ value: string; seq: string | number }>(
          'select value, seq from planny_state where id = 1 for update',
        );
        const row = rows[0];
        if (!row) throw new Error('planny_state row is missing');
        writeFileSync(file, row.value);
        const result = await work(file);
        const updated = readFileSync(file, 'utf8');
        let parsed: { seq?: number };
        try {
          parsed = JSON.parse(updated) as { seq?: number };
        } catch {
          parsed = {};
        }
        parsed.seq = Math.max(parsed.seq ?? 0, Number(row.seq) || 0) + 1;
        const next = JSON.stringify(parsed);
        await tx.query('update planny_state set value = $1, seq = $2 where id = 1', [next, parsed.seq]);
        return result;
      });
    } catch (error) {
      if (error instanceof StoreUnavailableError) throw error;
      throw new StoreUnavailableError(error instanceof Error ? error.message : undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const redis: RedisLike = {
    eval: (source, keys, argv) => withState(async (file) => {
      const db = createMiniRedis({ file });
      return db.transaction((run: CommandFn) => runner.run(source, keys, argv, run));
    }),
    hgetall: (key) => withState(async (file) => {
      const db = createMiniRedis({ file });
      return db.transaction((run) => run('HGETALL', [key]) as unknown as Record<string, string>);
    }),
    zrangebyscore: (key, max, limit) => withState(async (file) => {
      const db = createMiniRedis({ file });
      return db.transaction((run) => run('ZRANGEBYSCORE', [key, '-inf', String(max), 'LIMIT', '0', String(limit)]) as unknown as string[]);
    }),
  };

  const control = {
    async uploadsEnabled(): Promise<boolean> {
      await ensure();
      const { rows } = await client.query<{ enabled: boolean }>('select enabled from planny_control where id = 1');
      return rows[0]?.enabled === true;
    },
    async setUploadsEnabled(enabled: boolean): Promise<void> {
      await ensure();
      await client.query(
        'insert into planny_control (id, enabled) values (1, $1) on conflict (id) do update set enabled = excluded.enabled',
        [enabled],
      );
    },
  };

  return {
    build: 'vercel',
    redis,
    control,
    blobs: {
      async put(id: string, bytes: Uint8Array): Promise<void> {
        await ensure();
        const { rows } = await client.query<{ id: string }>(
          'insert into planny_plans (id, html) values ($1, $2) on conflict (id) do nothing returning id',
          [id, Buffer.from(bytes)],
        );
        if (rows.length === 0) throw new Error(`The plan id ${id} already exists.`);
      },
      async get(id: string): Promise<Uint8Array | null> {
        await ensure();
        const { rows } = await client.query<{ html: Uint8Array }>('select html from planny_plans where id = $1', [id]);
        const html = rows[0]?.html;
        return html ? new Uint8Array(html) : null;
      },
      async remove(id: string): Promise<void> {
        await ensure();
        await client.query('delete from planny_plans where id = $1', [id]);
      },
    },
    async purge(id: string): Promise<void> {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await dangerouslyDeleteByTag(`plan-${id}`);
          return;
        } catch (error) {
          const shaped = error as { status?: number; message?: string };
          const limited = shaped.status === 429 || /\b429\b/.test(String(shaped.message));
          if (!limited || attempt >= 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    },
  };
}
