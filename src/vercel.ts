import type { AppDeps } from './app.js';
import { createApp } from './app.js';
import type { App } from './app.js';
import { loadConfig } from './config.js';
import { createBlobStore, StoreUnavailableError } from './stores/blob.js';
import { createVercelStore } from './stores/vercel.js';
import type { Logger } from './app.js';

const DEFAULT_ORIGIN = 'https://planny-pink.vercel.app';

const defaultLog: Logger = {
  error: (...args) => console.error(...args),
  alert: (message, fields) => console.error(`ALERT ${message} ${JSON.stringify(fields)}`),
};

export function createVercelApp({
  env = process.env,
  waitUntil,
  now,
  log = defaultLog,
  blobClient,
  ...storeDeps
}: {
  env?: Record<string, string | undefined>;
  waitUntil?: AppDeps['waitUntil'];
  now?: () => number;
  log?: Logger;
  client?: Parameters<typeof createVercelStore>[0] extends infer D ? (D extends { client?: infer C } ? C : never) : never;
  blob?: Parameters<typeof createVercelStore>[0] extends infer D ? (D extends { blob?: infer B } ? B : never) : never;
  blobClient?: import('./stores/blob.js').BlobApiClient;
  readConfig?: (key: string) => Promise<unknown>;
  purge?: (tag: string) => Promise<void>;
}): App & { handle(request: Request, options?: { address?: string }): Promise<Response> } {
  // The Blob token is already a long-lived secret; use it as the fallback HMAC key so a
  // working Blob-only deploy needs no extra secret invented by hand.
  const secret = env.PLANNY_ADDRESS_KEY ?? env.BLOB_READ_WRITE_TOKEN;
  if (!secret) throw new Error('planny needs BLOB_READ_WRITE_TOKEN or PLANNY_ADDRESS_KEY.');
  const blobOnly = Boolean(env.BLOB_READ_WRITE_TOKEN) && !env.UPSTASH_REDIS_REST_URL && !env.KV_REST_API_URL;
  if (blobOnly && !env.BLOB_READ_WRITE_TOKEN) throw new Error('planny needs BLOB_READ_WRITE_TOKEN.');
  const blobKey = env.PLANNY_BLOB_KEY_1 ?? env.BLOB_READ_WRITE_TOKEN;
  // Fail closed: an unset BLOB_ACCESS defaults to private, and an unknown value
  // refuses to start rather than guessing. The env value does not prove the store's
  // real ACL; verify the store itself in the Vercel dashboard.
  const accessEnv = env.BLOB_ACCESS ?? 'private';
  if (accessEnv !== 'private' && accessEnv !== 'public') {
    throw new Error(`planny: BLOB_ACCESS must be 'private' or 'public', got '${accessEnv}'.`);
  }
  const store = blobOnly
    ? createBlobStore({
      token: env.BLOB_READ_WRITE_TOKEN ?? '',
      access: accessEnv,
      ...(blobKey ? { pathKey: blobKey } : {}),
      ...(blobClient ? { client: blobClient } : {}),
    })
    : createVercelStore({ env, ...storeDeps });
  const app = createApp({
    build: 'vercel',
    store,
    config: loadConfig(env),
    secret,
    origin: (env.PLANNY_PUBLIC_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, ''),
    ...(env.PLANNY_ADMIN_TOKEN ? { adminToken: env.PLANNY_ADMIN_TOKEN } : {}),
    ...(now ? { now } : {}),
    log,
    ...(waitUntil ? { waitUntil } : {}),
  });
  return Object.assign(app, {
    handle: async (request: Request, options: { address?: string } = {}) =>
      app.fetch(request, { address: options.address ?? 'unknown' }),
  });
}
