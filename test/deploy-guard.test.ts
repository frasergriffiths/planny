import { expect, test } from 'bun:test';
import { assertMainBranch, assertProPlan, planFromInspect } from '../src/deploy-guard.js';

test('the deploy guard passes only a Pro plan', () => {
  expect(planFromInspect({ plan: 'pro' })).toBe('pro');
  expect(planFromInspect({ plan: 'hobby' })).toBe('hobby');
  expect(planFromInspect({ plan: 'enterprise' })).toBe('unknown');
  expect(planFromInspect({})).toBe('unknown');
  expect(planFromInspect(null)).toBe('unknown');
  expect(planFromInspect('pro')).toBe('unknown');
  expect(() => assertProPlan({ plan: 'hobby' })).toThrow(/not pro/);
  expect(() => assertProPlan({})).toThrow(/not pro/);
  expect(() => assertProPlan({ plan: 'pro' })).not.toThrow();
});

test('the deploy guard refuses a non-main branch', () => {
  expect(() => assertMainBranch('main')).not.toThrow();
  expect(() => assertMainBranch('main\n')).not.toThrow();
  expect(() => assertMainBranch('oss-readiness')).toThrow(/not main/);
  expect(() => assertMainBranch('')).toThrow(/not main/);
});

test('the health route is uncached and names the build', async () => {
  const { createApp } = await import('../src/app.js');
  const { loadConfig } = await import('../src/config.js');
  const { createLocalStore } = await import('../src/stores/local.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'planny-health-'));
  try {
    const app = createApp({
      build: 'local',
      store: createLocalStore({ dataDir: dir }),
      config: loadConfig(),
      secret: 'test-secret',
      origin: 'http://127.0.0.1:4317',
      log: { error: () => {}, alert: () => {} },
    });
    const response = await app.fetch(new Request('http://127.0.0.1:4317/health'), { address: '203.0.113.7' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, build: 'local' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
