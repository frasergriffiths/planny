import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { clientAddress, sendResponse, toRequest } from '../src/http.js';
import { loadOrCreateSecret } from '../src/secret.js';
import { createLocalStore } from '../src/stores/local.js';

// Always 127.0.0.1: the local build is never reachable from another device.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PLANNY_LOCAL_PORT || 4317);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.PLANNY_DATA_DIR
  || join(homedir(), 'Library', 'Application Support', 'planny-local');
const STATIC = /^\/(planny\.css|fonts\/[a-z0-9-]+\.woff2)$/;
const TYPES = { css: 'text/css; charset=utf-8', woff2: 'font/woff2' };

const app = createApp({
  build: 'local',
  store: createLocalStore({ dataDir }),
  config: loadConfig(),
  secret: loadOrCreateSecret(join(dataDir, 'address.key')),
  origin: `http://${HOST}:${PORT}`,
});

function serveStatic(req, res) {
  const { pathname } = new URL(req.url || '/', 'http://localhost');
  if (!STATIC.test(pathname) || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const file = join(root, 'public', pathname);
  try {
    const { size } = statSync(file);
    res.writeHead(200, {
      'content-type': TYPES[file.split('.').pop()],
      'content-length': size,
      'cache-control': 'public, max-age=3600',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host ?? '').toLowerCase();
    const port = String(req.socket.localPort ?? PORT);
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`${JSON.stringify({ error: { code: 'bad_host', message: 'This server answers only on 127.0.0.1 and localhost.' } })}\n`);
      return;
    }
    if (serveStatic(req, res)) return;
    const request = toRequest(req, 'http');
    const response = await app.handle(request, { address: clientAddress(req) });
    await sendResponse(res, response, req.method);
  } catch (error) {
    console.error('planny local: could not answer a request', error.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    res.end(`${JSON.stringify({ error: { code: 'server_error', message: 'planny could not answer. Try again in a minute.' } })}\n`);
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : PORT;
  console.log(`planny local build listening on http://${HOST}:${actual}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
