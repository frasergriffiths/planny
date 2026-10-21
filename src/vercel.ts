import type { AppDeps } from './app.js';
import { createApp } from './app.js';
import type { App } from './app.js';
import { loadConfig } from './config.js';
import { createBlobStore } from './stores/blob.js';
import { createPostgresClient, createPostgresStore, type PostgresClient } from './stores/postgres.js';
import type { BlobApiClient } from './stores/blob.js';
import type { Logger } from './app.js';

const DEFAULT_ORIGIN = 'https://use-planny.vercel.app';

const defaultLog: Logger = {
  error: (...args) => console.error(...args),
  alert: (message, fields) => console.error(`ALERT ${message} ${JSON.stringify(fields)}`),
};

// Vercel Blob stays the default. Postgres is selected with PLANNY_STORE=postgres for a
// Neon database, and the local build keeps SQLite (stores/local.ts).
export function createVercelApp({
  env = process.env,
  waitUntil,
  now,
  log = defaultLog,
  blobClient,
  postgresClient,
}: {
  env?: Record<string, string | undefined>;
  waitUntil?: AppDeps['waitUntil'];
  now?: () => number;
  log?: Logger;
  blobClient?: BlobApiClient;
  postgresClient?: PostgresClient;
}): App & { handle(request: Request, options?: { address?: string }): Promise<Response> } {
  const mode = env.PLANNY_STORE ?? 'blob';
  if (mode !== 'blob' && mode !== 'postgres') {
    throw new Error(`planny: PLANNY_STORE must be 'blob' or 'postgres', got '${mode}'.`);
  }

  let store;
  let secret: string;
  if (mode === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('planny needs DATABASE_URL when PLANNY_STORE=postgres.');
    if (!env.PLANNY_ADDRESS_KEY) throw new Error('planny needs PLANNY_ADDRESS_KEY when PLANNY_STORE=postgres.');
    secret = env.PLANNY_ADDRESS_KEY;
    store = createPostgresStore({ client: postgresClient ?? createPostgresClient(env.DATABASE_URL) });
  } else {
    // The Blob token is already a long-lived secret; use it as the fallback HMAC key so a
    // working Blob-only deploy needs no extra secret invented by hand.
    secret = env.PLANNY_ADDRESS_KEY ?? env.BLOB_READ_WRITE_TOKEN ?? '';
    if (!secret) throw new Error('planny needs BLOB_READ_WRITE_TOKEN or PLANNY_ADDRESS_KEY.');
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('planny needs BLOB_READ_WRITE_TOKEN.');
    const blobKey = env.PLANNY_BLOB_KEY_1 ?? env.BLOB_READ_WRITE_TOKEN;
    // Fail closed: an unset BLOB_ACCESS defaults to private, and an unknown value
    // refuses to start rather than guessing. The env value does not prove the store's
    // real ACL; verify the store itself in the Vercel dashboard.
    const accessEnv = env.BLOB_ACCESS ?? 'private';
    if (accessEnv !== 'private' && accessEnv !== 'public') {
      throw new Error(`planny: BLOB_ACCESS must be 'private' or 'public', got '${accessEnv}'.`);
    }
    store = createBlobStore({
      token: env.BLOB_READ_WRITE_TOKEN ?? '',
      access: accessEnv,
      ...(blobKey ? { pathKey: blobKey } : {}),
      ...(blobClient ? { client: blobClient } : {}),
    });
  }
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
