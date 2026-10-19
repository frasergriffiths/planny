#!/usr/bin/env node
// Parity: start the JS reference from reference/ and this build on free ports, each with its
// own data folder and the same limits. Send both the same fixtures and compare status, headers
// and bodies. Then run this build behind a 1-byte stored guard and a 1-read guard.
//   bun run scripts/parity.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const referenceRoot = join(tsRoot, 'reference');
const bun = Bun.which('bun') ?? 'bun';
// Match the reference's defaults.
const NORMAL = {
  PLANNY_CACHE_TTL_SECONDS: '300',
  PLANNY_SITE_BYTES: '838860800',
  PLANNY_OWNER_BYTES: '41943040',
  PLANNY_MONTHLY_UPLOADS: '1500',
  PLANNY_MONTHLY_READS: '8000',
  PLANNY_MONTHLY_READ_BYTES: '8000000000',
  PLANNY_ADMIN_TOKEN: 'parity-admin',
};
const ADMIN = { authorization: 'Bearer parity-admin', 'content-type': 'application/json' };
const JUNK = '00000000-0000-0000-0000-000000000000';
const HIGH_LIMITS = {
  PLANNY_RATE_UPLOADS_MAX: '1000',
  PLANNY_RATE_VIEWS_MAX: '1000',
  PLANNY_RATE_UPLOADS_WINDOW: '3600',
};

interface Server {
  name: string;
  base: string;
  child?: ChildProcess;
}

interface StartedServer extends Server {
  child: ChildProcess;
}

async function waitFor(base: string): Promise<boolean> {
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(`${base}/`, { headers: { host: new URL(base).host } });
      if (response.status === 200) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  return false;
}

async function startTs(port: number, env: Record<string, string> = {}): Promise<StartedServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-parity-ts-'));
  const child = spawn(bun, ['run', 'server.ts'], {
    cwd: tsRoot,
    env: {
      ...process.env,
      ...NORMAL,
      ...HIGH_LIMITS,
      ...env,
      PLANNY_LOCAL_PORT: String(port),
      PLANNY_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const listening = new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`the TS build did not start on port ${port}. Output:\n${output}`)), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the TS build exited with ${code}. Output:\n${output}`));
    });
  });
  try {
    const actual = await listening;
    const server: StartedServer = { name: 'ts', base: `http://127.0.0.1:${actual}`, child };
    if (!(await waitFor(server.base))) throw new Error(`the TS build did not answer. Output:\n${output}`);
    return server;
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

async function stop(server: Server): Promise<void> {
  const child = server.child;
  if (!child) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolveWait) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveWait();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

interface Reply {
  status: number;
  contentType: string | null;
  cache: string | null;
  cdnCache: string | null;
  headers: Headers;
  body: string;
  json: unknown;
}

async function ask(server: Server, path: string, init: RequestInit = {}): Promise<Reply> {
  const headers = new Headers(init.headers);
  headers.set('host', new URL(server.base).host);
  const response = await fetch(`${server.base}${path}`, { ...init, headers, redirect: 'manual' });
  const body = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cache: response.headers.get('cache-control'),
    cdnCache: response.headers.get('vercel-cdn-cache-control'),
    headers: response.headers,
    body,
    json,
  };
}

function errorOf(reply: Reply): { code: string; message: string } | null {
  const shape = reply.json as { error?: { code?: string; message?: string } } | null;
  return shape?.error?.code && shape.error.message ? { code: shape.error.code, message: shape.error.message } : null;
}

function planContent(html: string): string {
  const withoutBanner = html.replace(/<div class="planny-local"[\s\S]*?<\/div>/, '');
  // The plan footer is new in this build: strip it so the sanitised plan itself compares.
  const withoutFooter = withoutBanner.replace(/<div class="planny-plan-footer"[\s\S]*?<\/div>/, '');
  return withoutFooter.replace(/<title>[^<]*<\/title>/, '<title></title>');
}

const PLAN = '<!doctype html><html><head><title>Parity plan</title><style>p{color:#1B2430}</style></head>'
  + '<body><h1>Q4</h1><a href="https://evil.example">link</a><table><tr><td colspan="2">x</td></tr></table>'
  + '<svg viewBox="0 0 2 2"><rect width="1" height="1" fill="#5E6B78"/></svg>'
  + '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot"><p onclick="x()">body</p><script>alert(1)</script></body></html>';

let passes = 0;
const failures: string[] = [];

function record(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    passes += 1;
    console.log(`PASS ${label}`);
  } else {
    failures.push(`${label}${detail ? ` (${detail})` : ''}`);
    console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function startJs(port: number): Promise<StartedServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-parity-js-'));
  const child = spawn(bun, ['run', 'local/server.js'], {
    cwd: referenceRoot,
    env: {
      ...process.env,
      ...NORMAL,
      ...HIGH_LIMITS,
      PLANNY_LOCAL_PORT: String(port),
      PLANNY_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const listening = new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`the JS reference did not start on port ${port}. Output:\n${output}`)), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the JS reference exited with ${code}. Output:\n${output}`));
    });
  });
  try {
    const actual = await listening;
    const server: StartedServer = { name: 'js', base: `http://127.0.0.1:${actual}`, child };
    if (!(await waitFor(server.base))) throw new Error(`the JS reference did not answer. Output:\n${output}`);
    return server;
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

async function parity(js: Server, ts: Server): Promise<void> {
  for (const path of ['/', '/nowhere', '/p/not-a-plan', `/p/${JUNK}`]) {
    const [a, b] = await Promise.all([ask(js, path), ask(ts, path)]);
    record(a.status === b.status && a.contentType === b.contentType && a.cache === b.cache,
      `GET ${path}: status and headers`, `${a.status}/${a.cache} vs ${b.status}/${b.cache}`);
  }

  const cases: Array<[string, (server: Server) => Promise<Reply>, string]> = [
    ['upload without a content type', (server) => ask(server, '/plans?name=x', { method: 'POST', body: PLAN }), 'unsupported_type'],
    ['upload with no name', (server) => ask(server, '/plans?duration=1d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }), 'name_required'],
    ['upload with a bad duration', (server) => ask(server, '/plans?name=x&duration=forever', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }), 'invalid_duration'],
    ['upload too short a duration', (server) => ask(server, '/plans?name=x&duration=0h', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }), 'duration_too_short'],
    ['upload too long a duration', (server) => ask(server, '/plans?name=x&duration=101y', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }), 'duration_too_long'],
    ['upload with an empty body', (server) => ask(server, '/plans?name=x&duration=1d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: '' }), 'empty_body'],
    ['upload over 4 MiB', (server) => ask(server, '/plans?name=x&duration=1d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: 'x'.repeat(4 * 1024 * 1024 + 1) }), 'too_large'],
    ['upload with a deeply nested plan', (server) => ask(server, '/plans?name=x&duration=1d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: '<div>'.repeat(5000) }), 'too_deep'],
    ['wrong HTTP method on /plans', (server) => ask(server, '/plans', { method: 'PUT' }), 'method_not_allowed'],
  ];
  for (const [label, call, code] of cases) {
    const [a, b] = await Promise.all([call(js), call(ts)]);
    const errorA = errorOf(a);
    const errorB = errorOf(b);
    record(a.status === b.status && errorA?.code === code && errorB?.code === code && errorA?.message === errorB?.message,
      label, `${a.status}/${errorA?.code} vs ${b.status}/${errorB?.code}`);
  }

  const [uploadA, uploadB] = await Promise.all([
    ask(js, '/plans?name=Parity&duration=2d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }),
    ask(ts, '/plans?name=Parity&duration=2d', { method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN }),
  ]);
  const shape = (reply: Reply): Record<string, unknown> => {
    const json = reply.json as Record<string, unknown>;
    return { status: reply.status, keys: Object.keys(json).sort(), removed: json.removed, contentType: reply.contentType, name: json.name };
  };
  record(JSON.stringify(shape(uploadA)) === JSON.stringify(shape(uploadB)), 'upload reply shape and sanitiser report',
    `${JSON.stringify(shape(uploadA))} vs ${JSON.stringify(shape(uploadB))}`);
  const planA = String((uploadA.json as { url: string }).url);
  const planB = String((uploadB.json as { url: string }).url);

  const [viewA, viewB] = await Promise.all([ask(js, new URL(planA).pathname), ask(ts, new URL(planB).pathname)]);
  const headersA = [viewA.status, viewA.contentType, viewA.cache, viewA.cdnCache].join('|');
  const headersB = [viewB.status, viewB.contentType, viewB.cache, viewB.cdnCache].join('|');
  record(headersA === headersB, 'plan view headers', `${headersA} vs ${headersB}`);
  record(planContent(viewA.body) === planContent(viewB.body), 'sanitised plan output is identical');

  const [queryA, queryB] = await Promise.all([
    ask(js, `${new URL(planA).pathname}?x=1`),
    ask(ts, `${new URL(planB).pathname}?x=1`),
  ]);
  record(queryA.status === 404 && queryB.status === 404, 'plan link with a query string is a 404', `${queryA.status} vs ${queryB.status}`);

  const [noKeyA, noKeyB] = await Promise.all([
    ask(js, new URL(planA).pathname, { method: 'DELETE' }),
    ask(ts, new URL(planB).pathname, { method: 'DELETE' }),
  ]);
  record(noKeyA.status === 401 && noKeyB.status === 401 && errorOf(noKeyA)?.code === errorOf(noKeyB)?.code,
    'delete without a key is 401', `${noKeyA.status} vs ${noKeyB.status}`);

  const keyA = String((uploadA.json as { deleteKey: string }).deleteKey);
  const keyB = String((uploadB.json as { deleteKey: string }).deleteKey);
  const [wrongA, wrongB] = await Promise.all([
    ask(js, new URL(planA).pathname, { method: 'DELETE', headers: { authorization: 'Bearer nope' } }),
    ask(ts, new URL(planB).pathname, { method: 'DELETE', headers: { authorization: 'Bearer nope' } }),
  ]);
  record(wrongA.status === 403 && wrongB.status === 403 && errorOf(wrongA)?.code === errorOf(wrongB)?.code,
    'delete with the wrong key is 403', `${wrongA.status} vs ${wrongB.status}`);
  const [goneA, goneB] = await Promise.all([
    ask(js, new URL(planA).pathname, { method: 'DELETE', headers: { authorization: `Bearer ${keyA}` } }),
    ask(ts, new URL(planB).pathname, { method: 'DELETE', headers: { authorization: `Bearer ${keyB}` } }),
  ]);
  record(goneA.status === 200 && goneB.status === 200, 'delete with the right key is 200', `${goneA.status} vs ${goneB.status}`);
  const [afterA, afterB] = await Promise.all([ask(js, new URL(planA).pathname), ask(ts, new URL(planB).pathname)]);
  record(afterA.status === 410 && afterB.status === 410 && afterA.cache === 'no-store' && afterB.cache === 'no-store',
    'deleted plan is 410 and not cached', `${afterA.status}/${afterA.cache} vs ${afterB.status}/${afterB.cache}`);

  const adminId = '00000000-0000-4000-8000-000000000000';
  const [adminA, adminB] = await Promise.all([
    ask(js, `/admin/plans/${adminId}/remove`, { method: 'POST' }),
    ask(ts, `/admin/plans/${adminId}/remove`, { method: 'POST' }),
  ]);
  record(adminA.status === 404 && adminB.status === 401,
    'admin route is TS-only (the reference has none), and the TS route needs its token',
    `${adminA.status} vs ${adminB.status}`);
  const [withToken] = await Promise.all([
    ask(ts, `/admin/plans/${adminId}/remove`, { method: 'POST', headers: ADMIN }),
  ]);
  record(withToken.status === 200 && (withToken.json as { outcome?: string }).outcome === 'missing',
    'admin takedown with the token answers for an unknown plan', `${withToken.status}`);
}

async function guards(): Promise<void> {
  const cases = [
    { name: '1-byte stored guard', env: { PLANNY_SITE_BYTES: '1' }, code: 'storage_full' },
    { name: '1-read guard', env: { PLANNY_MONTHLY_READS: '0' }, code: null },
  ];
  for (const guard of cases) {
    const server = await startTs(0, guard.env);
    try {
      const reply = await ask(server, '/plans?name=Guard&duration=1h', {
        method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN,
      });
      if (guard.code) {
        record(reply.status === 503 && errorOf(reply)?.code === guard.code,
          `${guard.name}: upload refused with ${guard.code}`, `${reply.status}/${errorOf(reply)?.code}`);
        continue;
      }
      record(reply.status === 201, `${guard.name}: upload accepted`, String(reply.status));
      const plan = String((reply.json as { url: string }).url);
      const key = String((reply.json as { deleteKey: string }).deleteKey);
      const view = await ask(server, new URL(plan).pathname);
      record(view.status === 503 && view.cache === 'no-store' && view.cdnCache === null
        && view.body.includes('New plan reads are paused.') && view.body.includes('Deletes and takedowns still work.'),
        `${guard.name}: view is the paused page, no-store`, `${view.status}/${view.cache}`);
      const del = await ask(server, new URL(plan).pathname, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
      record(del.status === 200, `${guard.name}: delete still works while paused`, String(del.status));
      const reset = await ask(server, '/admin/reset', { method: 'POST', headers: ADMIN, body: JSON.stringify({ counter: 'reads' }) });
      record(reset.status === 200, `${guard.name}: admin reset answers`, String(reset.status));
      const afterReset = await ask(server, `${new URL(plan).pathname}`);
      record(afterReset.status === 410, `${guard.name}: after reset the deleted plan is still gone`, String(afterReset.status));
    } finally {
      await stop(server);
    }
  }
}

try {
  console.log('parity: JS reference and TS build on free ports, each with its own data folder');
  const [js, ts] = await Promise.all([startJs(0), startTs(0)]);
  try {
    await parity(js, ts);
  } finally {
    await Promise.all([stop(js), stop(ts)]);
  }
  console.log('\nguard checks, run locally on the TS build');
  await guards();
} finally {
  console.log(`\n${passes} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  FAILED: ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}
