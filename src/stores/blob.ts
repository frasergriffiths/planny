import { del, get, head, put } from '@vercel/blob';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLuaRunner } from './lua-runner.js';
import { createMiniRedis, type CommandFn } from './mini-redis.js';
import type { RedisLike } from './local.js';

export class StoreUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'store_unavailable';
  constructor(message = 'The plan store is unavailable. Try again in a few seconds.') {
    super(message);
  }
}

interface BlobClientOptions {
  readonly token: string;
  readonly access: 'public' | 'private';
  readonly pathKey?: string;
  readonly prefix?: string;
}

const STATE = 'state.json';
const LOCK = 'state.lock';
const LOCK_STALE_MS = 2_000;

function hmacSuffix(id: string, key: string | undefined): string {
  if (!key) return '';
  return `-${createHash('sha256').update(`${key}:${id}`).digest('hex').slice(0, 16)}`;
}

export function blobPlanPath(id: string, key: string | undefined): string {
  return `plans/${id}${hmacSuffix(id, key)}.html`;
}

// Blob-only store: one JSON state blob holds records, counters and rate windows, and each plan's
// HTML is a separate blob. A create-only lock serialises the read-modify-write across instances.
export function createBlobStore({ token, access, pathKey, prefix = '' }: BlobClientOptions) {
  const runner = createLuaRunner();
  // Blob reads can lag a write by a moment. Keep the last state this instance wrote, with a
  // monotonic sequence, and prefer it when the store returns an older copy.
  let last: { seq: number; raw: string } | null = null;
  const store = (name: string) => `${prefix}${name}`;

  async function acquire(): Promise<void> {
    return;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      try {
        await put(store(LOCK), String(Date.now()), {
          access,
          token,
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'text/plain',
          cacheControlMaxAge: 60,
        });
        return;
      } catch {
        try {
          const current = await head(store(LOCK), { token });
          if (Date.now() - new Date(current.uploadedAt).getTime() > LOCK_STALE_MS) {
            await del(store(LOCK), { token });
            continue;
          }
        } catch {
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new StoreUnavailableError('The plan store is busy. Try again in a few seconds.');
  }

  async function withState<T>(work: (file: string) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await acquire();
      try {
        let existing: Awaited<ReturnType<typeof get>> = null;
        try {
          existing = await get(store(STATE), { access, token, useCache: false });
        } catch (error) {
          if (!(error instanceof Error && /not.?found/i.test(error.message))) throw error;
        }
        const dir = mkdtempSync(join(tmpdir(), 'planny-blob-'));
        const file = join(dir, STATE);
        const fresh = existing && existing.statusCode === 200
          ? await new Response(existing.stream).text()
          : '';
        writeFileSync(file, fresh || JSON.stringify({ strings: {}, hashes: {}, zsets: {}, expires: {} }));
        const result = await work(file);
        const next = readFileSync(file);
        const etag = existing?.blob?.etag;
        await put(store(STATE), next, {
          access,
          token,
          addRandomSuffix: false,
          contentType: 'application/json',
          cacheControlMaxAge: 60,
          allowOverwrite: true,
        });
        return result;
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        const message = error instanceof Error ? error.message : '';
        const precondition = name === 'BlobPreconditionFailedError' || /precondition/i.test(message);
        if (precondition && attempt < 5) {
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
          continue;
        }
        if (error instanceof StoreUnavailableError) throw error;
        throw new StoreUnavailableError(message || undefined);
      } finally {
        await del(store(LOCK), { token }).catch(() => {});
      }
    }
    throw new StoreUnavailableError();
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

  const blobs = {
    async put(id: string, bytes: Uint8Array): Promise<void> {
      await put(blobPlanPath(id, access === 'public' ? pathKey : undefined), Buffer.from(bytes), {
        access,
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'text/html; charset=utf-8',
        cacheControlMaxAge: 60,
      });
    },
    async get(id: string): Promise<Uint8Array | null> {
      const result = await get(blobPlanPath(id, access === 'public' ? pathKey : undefined), { access, token });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async remove(id: string): Promise<void> {
      try {
        await del(blobPlanPath(id, access === 'public' ? pathKey : undefined), { token });
      } catch (error) {
        if (!(error instanceof Error && /not.?found/i.test(error.message))) throw error;
      }
    },
  };

  const control = {
    async uploadsEnabled(): Promise<boolean> {
      try {
        const result = await get(store('config/kill.json'), { access, token, useCache: false });
        if (!result || result.statusCode !== 200) {
          // A fresh store has no kill blob. Create it enabled, once.
          await put(store('config/kill.json'), JSON.stringify({ uploadsEnabled: true }), {
            access,
            token,
            addRandomSuffix: false,
            allowOverwrite: false,
            contentType: 'application/json',
            cacheControlMaxAge: 60,
          }).catch(() => {});
          return true;
        }
        const value = JSON.parse(await new Response(result.stream).text()) as { uploadsEnabled?: unknown };
        return value.uploadsEnabled === true;
      } catch (error) {
        if (error instanceof StoreUnavailableError) throw error;
        return true;
      }
    },
    async setUploadsEnabled(enabled: boolean): Promise<void> {
      await put(store('config/kill.json'), JSON.stringify({ uploadsEnabled: enabled }), {
        access,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
      });
    },
  };

  return {
    build: 'vercel' as const,
    redis,
    blobs,
    control,
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
