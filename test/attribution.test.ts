import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/app.js';
import type { App } from '../src/app.js';
import { PLUR } from '../src/attribution.js';
import { loadConfig } from '../src/config.js';
import { PLAN_SCRIPT_HASH } from '../src/plan-script.js';
import { createLocalStore } from '../src/stores/local.js';

const ORIGIN = 'http://127.0.0.1:4317';
const ADDRESS = '203.0.113.9';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><h1>Hello</h1><p>Body</p></body></html>';
const MISSING = `${ORIGIN}/p/00000000-0000-4000-8000-000000000000`;

interface Fixture {
  readonly app: App;
  readonly store: ReturnType<typeof createLocalStore>;
  readonly clock: { t: number };
  cleanup(): void;
}

function setup(env: Record<string, string> = {}, build: 'local' | 'vercel' = 'local'): Fixture {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-attribution-'));
  const clock = { t: Date.UTC(2026, 9, 19, 12) };
  const store = createLocalStore({ dataDir, now: () => clock.t });
  const app = createApp({
    build,
    store,
    config: { ...loadConfig(env), uploadSpacingSeconds: 0 },
    secret: 'test-secret',
    origin: ORIGIN,
    now: () => clock.t,
    log: { error: () => {}, alert: () => {} },
  });
  return { app, store, clock, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

const view = (t: Fixture, path: string) => t.app.fetch(new Request(`${ORIGIN}${path}`), { address: ADDRESS });

async function uploaded(t: Fixture, body = PLAN) {
  const query = new URLSearchParams({ name: 'Plan', duration: '30d' });
  const response = await t.app.fetch(new Request(`${ORIGIN}/plans?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body,
  }), { address: ADDRESS });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ id: string; url: string; deleteKey: string }>;
}

const footerCount = (html: string) => html.split('<footer data-planny-attribution').length - 1;

test('a published plan ends with the viewer footer and keeps the plan CSP', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    const response = await view(t, new URL(json.url).pathname);
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(footerCount(body)).toBe(1);
    expect(body).toContain(`href="${PLUR}"`);
    expect(body).toContain('Made with Planny');
    // The footer is the viewer's, and it sits after the plan and after the copy script.
    expect(body.indexOf('<h1>Hello</h1>')).toBeLessThan(body.indexOf('<footer data-planny-attribution'));
    expect(body.indexOf('<script>')).toBeLessThan(body.indexOf('<footer data-planny-attribution'));
    expect(body.split('<script>').length - 1).toBe(1);

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts allow-top-navigation-by-user-activation');
    expect(csp).toContain(`script-src 'sha256-${PLAN_SCRIPT_HASH}'`);
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
  } finally {
    t.cleanup();
  }
});

test('the footer is absent when PLANNY_ATTRIBUTION is off', async () => {
  const t = setup({ PLANNY_ATTRIBUTION: 'off' });
  try {
    const json = await uploaded(t);
    const body = await (await view(t, new URL(json.url).pathname)).text();
    expect(footerCount(body)).toBe(0);
    expect(body).not.toContain('use-planny.vercel.app');
  } finally {
    t.cleanup();
  }
});

test('the footer is never inside the stored or sanitised plan', async () => {
  const t = setup();
  try {
    const imitation = '<!doctype html><html><body>'
      + `<footer data-planny-attribution><a href="${PLUR}">Made with Planny</a></footer>`
      + '<h1>Hi</h1></body></html>';
    const json = await uploaded(t, imitation);

    const stored = await t.store.blobs.get(json.id);
    const storedText = new TextDecoder().decode(stored ?? new Uint8Array());
    expect(storedText).not.toContain('data-planny-attribution');
    expect(storedText).not.toContain('use-planny.vercel.app');
    expect(storedText).not.toContain('<a ');

    const body = await (await view(t, new URL(json.url).pathname)).text();
    expect(footerCount(body)).toBe(1);
    expect(body.split('<a ').length - 1).toBe(1);
  } finally {
    t.cleanup();
  }
});

test('the sample carries the same footer and the plan policy', async () => {
  const t = setup();
  try {
    const response = await view(t, '/sample');
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(footerCount(body)).toBe(1);
    expect(body).toContain(`href="${PLUR}"`);
    expect(body.split('<script>').length - 1).toBe(1);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts allow-top-navigation-by-user-activation');
  } finally {
    t.cleanup();
  }
});

test('the sample footer follows the flag', async () => {
  const t = setup({ PLANNY_ATTRIBUTION: 'off' });
  try {
    const body = await (await view(t, '/sample')).text();
    expect(footerCount(body)).toBe(0);
    expect(body).not.toContain('use-planny.vercel.app');
  } finally {
    t.cleanup();
  }
});

test('the footer keeps display out of its inline style so print can hide it', async () => {
  const t = setup();
  try {
    const json = await uploaded(t);
    const body = await (await view(t, new URL(json.url).pathname)).text();
    const footer = /<footer data-planny-attribution style="([^"]*)">/.exec(body)?.[1] ?? '';
    expect(footer).not.toContain('display:');
    // Padding moved into the stylesheet so the 420px rule is not dead.
    expect(footer).not.toContain('padding:20px');
    expect(body).toContain('html body [data-planny-attribution]{display:block!important;padding:20px');
    expect(body).toContain('@media (max-width:420px){html body [data-planny-attribution]{padding-left:16px!important;padding-right:16px!important}}');
    expect(body).toContain('@media print{html body [data-planny-attribution]{display:none!important}}');
  } finally {
    t.cleanup();
  }
});

test('the 404 and 410 plan pages invite the reader to publish', async () => {
  const t = setup();
  try {
    const missing = await view(t, new URL(MISSING).pathname);
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    expect(missingBody).toContain('data-planny-invite');
    expect(missingBody).toContain(`href="${PLUR}"`);
    expect(missingBody).toContain('Publish it with Planny');
    // Inside <main>, before </body>: visible in the page, not appended after </html>.
    expect(missingBody.indexOf('<main>')).toBeLessThan(missingBody.indexOf('data-planny-invite'));
    expect(missingBody.indexOf('data-planny-invite')).toBeLessThan(missingBody.indexOf('</main>'));
    expect(missingBody.indexOf('data-planny-invite')).toBeLessThan(missingBody.indexOf('</body>'));

    const json = await uploaded(t);
    const removed = await t.app.fetch(new Request(`${ORIGIN}${new URL(json.url).pathname}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${json.deleteKey}` },
    }), { address: ADDRESS });
    expect(removed.status).toBe(200);
    const gone = await view(t, new URL(json.url).pathname);
    expect(gone.status).toBe(410);
    const goneBody = await gone.text();
    expect(goneBody).toContain('data-planny-invite');
    expect(goneBody).toContain('Publish it with Planny');
    expect(goneBody.indexOf('data-planny-invite')).toBeLessThan(goneBody.indexOf('</body>'));
  } finally {
    t.cleanup();
  }
});

test('the invitation follows the same flag', async () => {
  const t = setup({ PLANNY_ATTRIBUTION: 'off' });
  try {
    const missing = await view(t, new URL(MISSING).pathname);
    expect(missing.status).toBe(404);
    const body = await missing.text();
    expect(body).not.toContain('data-planny-invite');
    expect(body).not.toContain('use-planny.vercel.app');
  } finally {
    t.cleanup();
  }
});

// The built pages render in the browser after #root, so the server marks the flag on
// <html> and the React page renders the invite inside its card. These tests check the
// marker and that the shipped bundle carries the copy; placement is checked in the
// browser (see the report).
const htmlTag = (html: string) => /<html[^>]*>/i.exec(html)?.[0] ?? '';

test('the built 404 and 410 pages carry the attribution flag and the invite copy', async () => {
  const t = setup({}, 'vercel');
  try {
    const missing = await view(t, new URL(MISSING).pathname);
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    expect(htmlTag(missingBody)).toContain('data-planny-invite="on"');
    expect(missingBody).toContain('Publish it with Planny');
    expect(missingBody.trimEnd().endsWith('</html>')).toBe(true);

    const json = await uploaded(t);
    const removed = await t.app.fetch(new Request(`${ORIGIN}${new URL(json.url).pathname}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${json.deleteKey}` },
    }), { address: ADDRESS });
    expect(removed.status).toBe(200);
    const gone = await view(t, new URL(json.url).pathname);
    expect(gone.status).toBe(410);
    const goneBody = await gone.text();
    expect(htmlTag(goneBody)).toContain('data-planny-invite="on"');
    expect(goneBody).toContain('Publish it with Planny');
    expect(goneBody.trimEnd().endsWith('</html>')).toBe(true);
  } finally {
    t.cleanup();
  }
});

test('the built plan 404/410 mark the invite off when the flag is off', async () => {
  const t = setup({ PLANNY_ATTRIBUTION: 'off' }, 'vercel');
  try {
    const missing = await view(t, new URL(MISSING).pathname);
    expect(missing.status).toBe(404);
    expect(htmlTag(await missing.text())).toContain('data-planny-invite="off"');
  } finally {
    t.cleanup();
  }
});

test('the built generic 404 and the built 429 never advertise', async () => {
  for (const env of [{}, { PLANNY_ATTRIBUTION: 'off' }]) {
    const t = setup(env, 'vercel');
    try {
      const nowhere = await view(t, '/nowhere');
      expect(nowhere.status).toBe(404);
      expect(htmlTag(await nowhere.text())).not.toContain('data-planny-invite');

      const limited = setup({ ...env, PLANNY_RATE_VIEWS_MAX: '0' }, 'vercel');
      try {
        const json = await uploaded(limited);
        const response = await view(limited, new URL(json.url).pathname);
        expect(response.status).toBe(429);
        expect(htmlTag(await response.text())).not.toContain('data-planny-invite');
      } finally {
        limited.cleanup();
      }
    } finally {
      t.cleanup();
    }
  }
});

test('attribution off drops the navigation token from the plan policy', async () => {
  const t = setup({ PLANNY_ATTRIBUTION: 'off' });
  try {
    const json = await uploaded(t);
    const response = await view(t, new URL(json.url).pathname);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).not.toContain('allow-top-navigation');
    const sample = await view(t, '/sample');
    expect(sample.headers.get('content-security-policy') ?? '').not.toContain('allow-top-navigation');
  } finally {
    t.cleanup();
  }
});
