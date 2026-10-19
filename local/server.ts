import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import type { Logger } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadOrCreateSecret } from '../src/secret.js';
import { createLocalStore } from '../src/stores/local.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PLANNY_LOCAL_PORT ?? 4317);
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.PLANNY_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'planny-local');
const STATIC = /^\/(planny\.css|fonts\/[a-z0-9-]+\.woff2)$/i;
const TYPES: Readonly<Record<string, string>> = { css: 'text/css; charset=utf-8', woff2: 'font/woff2' };

const log: Logger = {
  error: (...args) => console.error(...args),
  alert: (message, fields) => console.error(`ALERT ${message} ${JSON.stringify(fields)}`),
};

// Builds the local serve config. It does not call Bun.serve: the root server.ts owns that, once.
// This module is never imported on Vercel, so the SQLite store and the Host check stay local.
export function localServeConfig() {
  const app = createApp({
    build: 'local',
    store: createLocalStore({ dataDir }),
    config: loadConfig(),
    secret: loadOrCreateSecret(join(dataDir, 'address.key')),
    origin: `http://${HOST}:${PORT}`,
    ...(process.env.PLANNY_ADMIN_TOKEN ? { adminToken: process.env.PLANNY_ADMIN_TOKEN } : {}),
    log,
  });
  return {
    hostname: HOST,
    port: PORT,
    fetch: (request: Request, server: { requestIP(request: Request): { address: string } | null; port: number }): Promise<Response> | Response => {
      const url = new URL(request.url);
      const port = server.port ?? PORT;
      const host = (request.headers.get('host') ?? '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        return new Response(
          `${JSON.stringify({ error: { code: 'bad_host', message: 'This server answers only on 127.0.0.1 and localhost.' } })}\n`,
          { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
        );
      }
      if (STATIC.test(url.pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
        const file = join(repo, 'public', url.pathname);
        try {
          const { size } = statSync(file);
          return new Response(request.method === 'HEAD' ? null : Bun.file(file).stream(), {
            status: 200,
            headers: {
              'content-type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream',
              'content-length': String(size),
              'cache-control': 'public, max-age=3600',
            },
          });
        } catch {
          return new Response('Not found\n', { status: 404 });
        }
      }
      // The local address comes from the socket, never from a header a client can set.
      const address = server.requestIP(request)?.address ?? 'unknown';
      return app.fetch(request, { address });
    },
  };
}
