import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createVercelStore } from './stores/vercel.js';

const DEFAULT_ORIGIN = 'https://planny-pink.vercel.app';

export function createVercelApp({ env = process.env, waitUntil, now, log = console, ...storeDeps } = {}) {
  if (!env.PLANNY_ADDRESS_KEY) throw new Error('planny needs PLANNY_ADDRESS_KEY set in the environment.');
  return createApp({
    build: 'vercel',
    store: createVercelStore({ env, ...storeDeps }),
    config: loadConfig(env),
    secret: env.PLANNY_ADDRESS_KEY,
    origin: (env.PLANNY_PUBLIC_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, ''),
    now,
    log,
    waitUntil,
  });
}
