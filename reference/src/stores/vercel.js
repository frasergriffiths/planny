import { del, get, put } from '@vercel/blob';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { get as readGlobalConfig } from '@vercel/global-config';
import { Redis } from '@upstash/redis';

const blobPath = (id) => `plans/${id}.html`;

function required(env, name) {
  if (!env[name]) throw new Error(`planny needs ${name} set in the environment.`);
  return env[name];
}

// The three calls the records layer makes, mapped onto the Upstash client. Scores are
// millisecond timestamps, so -inf is the same as the lowest possible score.
export function upstashRedis(client) {
  return {
    eval: (script, keys, args) => client.eval(script, keys, args),
    hgetall: (key) => client.hgetall(key),
    zrangebyscore: (key, max, limit) => client.zrange(key, '-inf', max, { byScore: true, offset: 0, count: limit }),
  };
}

// Purge calls over the rate limit return 429 and leave the cache as it was, so retry a few times.
// Vercel sends retry-after with that 429, so wait at least that long when it does.
async function purgeWithRetry(purgeTag, tag) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await purgeTag(tag);
    } catch (error) {
      const limited = error?.status === 429 || error?.statusCode === 429 || /\b429\b/.test(String(error?.message));
      if (!limited || attempt >= 5) throw error;
      const header = error?.headers?.get?.('retry-after') ?? error?.retryAfter;
      const seconds = Number(header);
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 5000) : 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export function createVercelStore({ env = process.env, client, blob, readConfig, purge } = {}) {
  const redisClient = client ?? new Redis({
    url: required(env, 'UPSTASH_REDIS_REST_URL'),
    token: required(env, 'UPSTASH_REDIS_REST_TOKEN'),
    automaticDeserialization: false,
  });
  const blobApi = blob ?? { put, get, del };
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
    purge: (id) => purgeWithRetry(purgeTag, `plan-${id}`),
  };
}
