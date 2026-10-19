import type { AppDeps } from './app.js';
import { createApp } from './app.js';
import type { App } from './app.js';
import { loadConfig } from './config.js';
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
  ...storeDeps
}: {
  env?: Record<string, string | undefined>;
  waitUntil?: AppDeps['waitUntil'];
  now?: () => number;
  log?: Logger;
  client?: Parameters<typeof createVercelStore>[0] extends infer D ? (D extends { client?: infer C } ? C : never) : never;
  blob?: Parameters<typeof createVercelStore>[0] extends infer D ? (D extends { blob?: infer B } ? B : never) : never;
  readConfig?: (key: string) => Promise<unknown>;
  purge?: (tag: string) => Promise<void>;
}): App & { handle(request: Request, options?: { address?: string }): Promise<Response> } {
  const secret = env.PLANNY_ADDRESS_KEY;
  if (!secret) throw new Error('planny needs PLANNY_ADDRESS_KEY set in the environment.');
  const app = createApp({
    build: 'vercel',
    store: createVercelStore({ env, ...storeDeps }),
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
