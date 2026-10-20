import { expect, test } from 'bun:test';
import { createVercelApp } from '../src/vercel.js';

const ORIGIN = 'https://planny-pink.vercel.app';
const PLAN = '<!doctype html><html><head><title>Plan</title></head><body><p onclick="x()">Hi</p></body></html>';

// Vercel Blob is the only storage on Vercel, so these tests drive the Blob-only
// glue through an injected fake Blob client.

function fakeBlobOnly() {
  const files = new Map<string, string>();
  return {
    files,
    async put(pathname: string, body: string | Uint8Array | Blob, options: Record<string, unknown>) {
      expect(options.access).toBe('private');
      const bytes = typeof body === 'string' ? body
        : body instanceof Uint8Array ? Buffer.from(body).toString()
        : Buffer.from(await (body as Blob).arrayBuffer()).toString();
      files.set(pathname, bytes);
    },
    async get(pathname: string, options: Record<string, unknown>) {
      expect(options.access).toBe('private');
      const file = files.get(pathname);
      if (!file) {
        throw Object.assign(new Error('blob not found'), { name: 'BlobNotFoundError' });
      }
      return { statusCode: 200, stream: new Blob([file]).stream() as unknown as ReadableStream<Uint8Array> };
    },
    async head(pathname: string) {
      if (!files.has(pathname)) throw Object.assign(new Error('blob not found'), { name: 'BlobNotFoundError' });
      return { uploadedAt: new Date().toISOString() };
    },
    async del(pathname: string | string[]) {
      for (const name of Array.isArray(pathname) ? pathname : [pathname]) files.delete(name);
    },
  };
}

function setup(env: Record<string, string | undefined> = {}) {
  const clock = { t: Date.UTC(2026, 9, 19, 12) };
  const blob = fakeBlobOnly();
  const app = createVercelApp({
    env: {
      BLOB_READ_WRITE_TOKEN: 'fake-token',
      BLOB_ACCESS: 'private',
      PLANNY_UPLOAD_SPACING_SECONDS: '0',
      ...env,
    },
    blobClient: blob,
    now: () => clock.t,
    log: { error: () => {}, alert: () => {} },
  });
  return { app, blob, clock };
}

const upload = (app: ReturnType<typeof createVercelApp>) => app.fetch(new Request(`${ORIGIN}/plans?name=Glue&duration=1h`, {
  method: 'POST',
  headers: { 'content-type': 'text/html' },
  body: PLAN,
}), { address: '198.51.100.9' });

const view = (app: ReturnType<typeof createVercelApp>, url: string) => app.fetch(new Request(url), { address: '198.51.100.9' });

test('the Vercel build stores HTML privately and serves it with the plan headers', async () => {
  const t = setup();
  const response = await upload(t.app);
  expect(response.status).toBe(201);
  const json = (await response.json()) as { id: string; url: string };
  expect(json.url.startsWith(`${ORIGIN}/p/`)).toBe(true);
  expect(t.blob.files.has(`plans/${json.id}.html`)).toBe(true);
  expect(t.blob.files.get(`plans/${json.id}.html`)?.toString()).not.toContain('onclick');
  const page = await view(t.app, json.url);
  expect(page.status).toBe(200);
  expect(page.headers.get('x-planny-build')).toBe('vercel');
  expect(await page.text()).not.toContain('LOCAL');
});

test('a missing plan uses the React 404 page on Vercel', async () => {
  const t = setup();
  const response = await view(t.app, `${ORIGIN}/p/00000000-0000-4000-8000-000000000000`);
  expect(response.status).toBe(404);
  const body = await response.text();
  expect(body).toContain('data-page="notfound"');
  expect(body).not.toContain('/planny.css');
});

test('deleting purges the plan blob and the page is gone', async () => {
  const t = setup();
  const json = (await (await upload(t.app)).json()) as { id: string; url: string; deleteKey: string };
  const del = await t.app.fetch(new Request(json.url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${json.deleteKey}` },
  }), { address: '198.51.100.9' });
  expect(del.status).toBe(200);
  expect(t.blob.files.has(`plans/${json.id}.html`)).toBe(false);
  expect((await view(t.app, json.url)).status).toBe(410);
});

test('the switch fails closed', async () => {
  const t = setup();
  await t.app.setUploadsEnabled(false);
  const off = await upload(t.app);
  expect(off.status).toBe(503);
  expect(((await off.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
  await t.app.setUploadsEnabled(true);
  expect((await upload(t.app)).status).toBe(201);
});

test('a failing kill-switch read pauses uploads', async () => {
  const t = setup();
  const realGet = t.blob.get.bind(t.blob);
  t.blob.get = async (pathname: string, options: Record<string, unknown>) => {
    if (pathname === 'config/kill.json') throw new Error('store exploded');
    return realGet(pathname, options);
  };
  await expect(t.app.uploadsEnabled()).rejects.toThrow(/store exploded/);
  const paused = await upload(t.app);
  expect(paused.status).toBe(503);
  expect(((await paused.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
});

test('takedown, expiry and purge work through the Blob-only store', async () => {
  const t = setup();
  const json = (await (await upload(t.app)).json()) as { id: string; url: string };
  expect(await t.app.takedown(json.id)).toEqual({ outcome: 'ok', purged: true });
  expect(t.blob.files.has(`plans/${json.id}.html`)).toBe(false);
  const page = await view(t.app, json.url);
  expect(page.status).toBe(410);
  expect(await page.text()).toContain('planny');

  const second = (await (await upload(t.app)).json()) as { id: string; url: string };
  t.clock.t += 2 * 3600e3;
  const results = await t.app.sweep();
  expect(results.find((result) => result.id === second.id)?.outcome).toBe('ok');
  expect(t.blob.files.has(`plans/${second.id}.html`)).toBe(false);
});

test('on a Blob-only Vercel build the App exposes the upload switch', async () => {
  const t = setup();
  expect(await t.app.uploadsEnabled()).toBe(true);
  await t.app.setUploadsEnabled(false);
  expect(await t.app.uploadsEnabled()).toBe(false);
  const paused = await upload(t.app);
  expect(paused.status).toBe(503);
  expect(((await paused.json()) as { error: { code: string } }).error.code).toBe('uploads_paused');
  await t.app.setUploadsEnabled(true);
  expect((await upload(t.app)).status).toBe(201);
});

test('an unknown BLOB_ACCESS fails closed', () => {
  expect(() => createVercelApp({
    env: { BLOB_READ_WRITE_TOKEN: 'fake-token', BLOB_ACCESS: 'Public ' },
    blobClient: fakeBlobOnly(),
    log: { error: () => {}, alert: () => {} },
  })).toThrow(/BLOB_ACCESS/);
});

test('an unset BLOB_ACCESS defaults to private', async () => {
  const t = setup({ BLOB_ACCESS: undefined });
  expect((await upload(t.app)).status).toBe(201);
  // A private store keeps plan HTML behind the app; no Blob-side hmac key is needed.
  expect(t.blob.files.has('state.json')).toBe(true);
});
