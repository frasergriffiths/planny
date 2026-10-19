#!/usr/bin/env bun
// Load test: one plan, many concurrent reads, then concurrent uploads from separate addresses.
//   bun run scripts/load.ts
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bun = Bun.which('bun') ?? 'bun';
const port = 4400 + Math.floor(Math.random() * 100);
const dataDir = mkdtempSync(join(tmpdir(), 'planny-load-'));
const env = {
  ...process.env,
  PLANNY_LOCAL_PORT: String(port),
  PLANNY_DATA_DIR: dataDir,
  PLANNY_RATE_VIEWS_MAX: '1000000',
  PLANNY_RATE_UPLOADS_MAX: '1000000',
  PLANNY_SITE_BYTES: '1000000000',
  PLANNY_OWNER_BYTES: '1000000000',
  PLANNY_MONTHLY_READS: '100000000',
  PLANNY_MONTHLY_READ_BYTES: '100000000000',
};

const server = spawn(bun, ['run', 'server.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const base = `http://127.0.0.1:${port}`;

async function waitForServer(): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(base)).status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('server did not start');
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

async function timed(count: number, work: (index: number) => Promise<Response>, concurrency: number) {
  const latencies: number[] = [];
  let failures = 0;
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= count) return;
      const started = performance.now();
      try {
        const response = await work(index);
        if (response.status >= 400) failures += 1;
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - started);
    }
  }
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  return {
    count,
    failures,
    seconds: elapsed,
    perSecond: Math.round(count / elapsed),
    p50: Math.round(percentile(latencies, 0.5)),
    p95: Math.round(percentile(latencies, 0.95)),
    p99: Math.round(percentile(latencies, 0.99)),
  };
}

try {
  await waitForServer();
  const plan = '<!doctype html><html><head><title>Load</title></head><body><h1>Load</h1><p>Body</p></body></html>';
  const upload = await fetch(`${base}/plans?name=Load&duration=1d`, {
    method: 'POST',
    headers: { 'content-type': 'text/html', 'x-forwarded-for': '198.18.0.1' },
    body: plan,
  });
  const json = (await upload.json()) as { url: string };
  const path = new URL(json.url).pathname;

  const reads = await timed(2000, () => fetch(`${base}${path}`, { headers: { 'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }), 100);
  const uploads = await timed(300, (index) => fetch(`${base}/plans?name=Load${index}&duration=1d`, {
    method: 'POST',
    headers: { 'content-type': 'text/html', 'x-forwarded-for': `203.0.${Math.floor(index / 250)}.${index % 250}` },
    body: plan,
  }), 25);
  console.log('reads ', JSON.stringify(reads));
  console.log('uploads', JSON.stringify(uploads));
} finally {
  server.kill('SIGTERM');
}
