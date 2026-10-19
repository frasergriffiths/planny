#!/usr/bin/env bun
// Body-limit probe: send raw bodies at the platform boundary sizes and print the app's answer.
// The app cap is 4,194,304 bytes; anything above it must be 413 before the body is kept.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sizes = [4_194_304, 4_194_305, 4_500_000, 4_500_001, 4_718_592];
const port = 4700 + Math.floor(Math.random() * 100);
const dataDir = mkdtempSync(join(tmpdir(), 'planny-probe-'));
const server = spawn(Bun.which('bun') ?? 'bun', ['run', 'server.ts'], {
  env: {
    ...process.env,
    PLANNY_LOCAL_PORT: String(port),
    PLANNY_DATA_DIR: dataDir,
    PLANNY_RATE_UPLOADS_MAX: '1000',
    PLANNY_SITE_BYTES: '1000000000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${port}`;

for (let index = 0; index < 100; index += 1) {
  try {
    if ((await fetch(base)).status === 200) break;
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

try {
  for (const size of sizes) {
    const body = `<p>${'x'.repeat(size - 7)}</p>`;
    const started = performance.now();
    const response = await fetch(`${base}/plans?name=Probe&duration=1h`, {
      method: 'POST',
      headers: { 'content-type': 'text/html' },
      body,
    });
    const elapsed = Math.round(performance.now() - started);
    let code = '';
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? '';
    } catch {
      code = '';
    }
    console.log(`${size} bytes -> ${response.status}${code ? ` ${code}` : ''} (${elapsed} ms)`);
  }
} finally {
  server.kill('SIGTERM');
}
