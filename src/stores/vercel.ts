import { del, get, put } from '@vercel/blob';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { get as readGlobalConfig } from '@vercel/global-config';
import { Redis } from '@upstash/redis';
import type { BlobStore, ControlStore, RedisLike, Store } from './local.js';

const blobPath = (id: string): string => `plans/${id}.html`;

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`planny needs ${name} set in the environment.`);
  return value;
}

interface UpstashClient {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  zrange(key: string, min: string, max: number, options: { byScore: true; offset: number; count: number }): Promise<string[]>;
}

// The three calls the records layer makes, mapped onto the Upstash client. Scores are
// millisecond timestamps, so -inf is the same as the lowest possible score.
export function upstashRedis(client: UpstashClient): RedisLike {
  return {
    eval: (script, keys, args) => client.eval(script, keys, args),
    hgetall: (key) => client.hgetall(key),
    zrangebyscore: (key, max, limit) => client.zrange(key, '-inf', max, { byScore: true, offset: 0, count: limit }),
  };
}

// Purge calls over the rate limit return 429 and leave the cache as it was, so retry a few times.
// Vercel sends retry-after with that 429, so wait at least that long when it does.
async function purgeWithRetry(purgeTag: (tag: string) => Promise<void>, tag: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await purgeTag(tag);
      return;
    } catch (error) {
      const shaped = error as { status?: number; statusCode?: number; message?: string; retryAfter?: number; headers?: { get?(name: string): string | null } };
      const limited = shaped.status === 429 || shaped.statusCode === 429 || /\b429\b/.test(String(shaped.message));
      if (!limited || attempt >= 5) throw error;
      const header = shaped.headers?.get?.('retry-after') ?? shaped.retryAfter;
      const seconds = Number(header);
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 5000) : 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export interface BlobApi {
  put(pathname: string, body: string | Uint8Array | Blob, options: { access: string; contentType?: string; addRandomSuffix?: boolean }): Promise<unknown>;
  get(pathname: string, options: { access: string }): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathname: string | string[]): Promise<void>;
}

export interface VercelStoreDeps {
  readonly env?: Record<string, string | undefined>;
  readonly client?: UpstashClient;
  readonly blob?: BlobApi;
  readonly readConfig?: (key: string) => Promise<unknown>;
  readonly purge?: (tag: string) => Promise<void>;
}

export function createVercelStore({ env = process.env, client, blob, readConfig, purge }: VercelStoreDeps = {}): Store {
  const redisUrl = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  const redisClient: UpstashClient = client ?? (new Redis({
    url: redisUrl ?? required(env, 'UPSTASH_REDIS_REST_URL'),
    token: redisToken ?? required(env, 'UPSTASH_REDIS_REST_TOKEN'),
    automaticDeserialization: false,
  }) as unknown as UpstashClient);
  const blobApi: BlobApi = blob ?? { put, get, del } as unknown as BlobApi;
  const readSwitch = readConfig ?? readGlobalConfig;
  const purgeTag = purge ?? dangerouslyDeleteByTag;
  return {
    build: 'vercel',
    redis: upstashRedis(redisClient),
    blobs: {
      async put(id, bytes) {
        await blobApi.put(blobPath(id), Buffer.from(bytes), {
          access: 'private',
          contentType: 'text/html; charset=utf-8',
          addRandomSuffix: false,
        });
      },
      async get(id) {
        const result = await blobApi.get(blobPath(id), { access: 'private' });
        if (!result || result.statusCode !== 200) return null;
        return new Uint8Array(await new Response(result.stream).arrayBuffer());
      },
      async remove(id) {
        try {
          await blobApi.del(blobPath(id));
        } catch (error) {
          if (!(error instanceof Error && error.name === 'BlobNotFoundError')) throw error;
        }
      },
    },
    control: {
      async uploadsEnabled() {
        return (await readSwitch('uploadsEnabled')) === true;
      },
      async setUploadsEnabled() {
        throw new Error('Change the upload switch with the Vercel CLI: vercel global-config update --patch.');
      },
    },
    purge: (id: string) => purgeWithRetry(purgeTag, `plan-${id}`),
  };
}
