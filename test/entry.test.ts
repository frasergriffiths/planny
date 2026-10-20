import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'bun:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bun = Bun.which('bun') ?? 'bun';
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

function start(env: Record<string, string>): Promise<{ base: string; child: ChildProcess; output: () => string }> {
  const port = 4500 + Math.floor(Math.random() * 400);
  let output = '';
  const child = spawn(bun, ['run', 'server.ts'], {
    cwd: root,
    env: { ...process.env, ...env, PLANNY_LOCAL_PORT: String(port), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  return new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => reject(new Error(`entry did not start: ${output}`)), 15_000);
    child.stdout?.on('data', () => {
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolveStart({ base: `http://127.0.0.1:${match[1]}`, child, output: () => output });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`entry exited ${code}: ${output}`));
    });
  });
}

test('the local entry serves pages, CSS and rejects a bad Host', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-entry-'));
  const server = await start({ PLANNY_DATA_DIR: dataDir });
  try {
    const home = await fetch(server.base);
    expect(home.status).toBe(200);
    expect(home.headers.get('x-planny-build')).toBe('local');
    expect(await home.text()).toContain('planny.css');
    expect((await fetch(`${server.base}/planny.css`)).status).toBe(200);
    const bad = await fetch(server.base, { headers: { host: 'evil.example' } });
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('bad_host');
  } finally {
    server.child.kill('SIGTERM');
  }
});

test('the Vercel entry runs the Vercel app, not the local one, with a fake env', async () => {
  const server = await start({
    VERCEL: '1',
    PLANNY_ADDRESS_KEY: 'test-address-key-that-is-long-enough-1234',
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_fake_fake',
    PLANNY_PUBLIC_ORIGIN: 'https://preview.example',
  });
  try {
    const home = await fetch(server.base);
    expect(home.status).toBe(200);
    expect(home.headers.get('x-planny-build')).toBe('vercel');
    expect(await home.text()).toContain('Share an HTML plan as a link');
  } finally {
    server.child.kill('SIGTERM');
  }
});
