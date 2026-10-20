import { expect, mock, test } from 'bun:test';

// The production Vercel entry reads process.env lazily and keeps module-level state
// (app, failure, purged), so this file mocks @vercel/blob and @vercel/functions, then
// drives three fresh copies of api/index.ts: preview, fail-closed and full.

interface EntryState {
  readonly files: Map<string, string>;
  readonly deletedTags: string[];
  purgeRequests: number;
  listShouldThrow: boolean;
}

const state: EntryState = {
  files: new Map(),
  deletedTags: [],
  purgeRequests: 0,
  listShouldThrow: false,
};

mock.module('@vercel/blob', () => ({
  list: async () => {
    state.purgeRequests += 1;
    if (state.listShouldThrow) throw Object.assign(new Error('rate limited'), { status: 429 });
    return {
      blobs: [...state.files.keys()]
        .filter((pathname) => /^plans\/([0-9a-f-]{36})/.test(pathname))
        .map((pathname) => ({ pathname })),
    };
  },
  put: async (pathname: string, body: string | Uint8Array | Blob) => {
    state.files.set(pathname, typeof body === 'string'
      ? body
      : Buffer.from(body instanceof Uint8Array ? body : new Uint8Array(await (body as Blob).arrayBuffer())).toString());
  },
  get: async (pathname: string) => {
    const file = state.files.get(pathname);
    if (!file) throw Object.assign(new Error('blob not found'), { name: 'BlobNotFoundError' });
    return { statusCode: 200, stream: new Blob([file]).stream() };
  },
  head: async (pathname: string) => {
    if (!state.files.has(pathname)) throw Object.assign(new Error('blob not found'), { name: 'BlobNotFoundError' });
    return { uploadedAt: new Date().toISOString() };
  },
  del: async (pathname: string | string[]) => {
    for (const name of Array.isArray(pathname) ? pathname : [pathname]) state.files.delete(name);
  },
}));

mock.module('@vercel/functions', () => ({
  waitUntil: (promise: unknown) => Promise.resolve(promise),
  dangerouslyDeleteByTag: async (tag: string) => {
    state.deletedTags.push(tag);
    if (tag.startsWith('plan-')) state.files.delete(`plans/${tag.slice(5)}.html`);
  },
}));

const ORIGIN = 'https://planny-pink.vercel.app';
const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const PLAN = '<!doctype html><html><head><title>Entry</title></head><body><p>Hi</p></body></html>';

const ENV_KEYS = [
  'VERCEL_ENV',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_ACCESS',
  'PLANNY_ADDRESS_KEY',
  'PLANNY_PUBLIC_ORIGIN',
  'PLANNY_ADMIN_TOKEN',
  'PLANNY_BLOB_KEY_1',
  'VERCEL_GIT_COMMIT_SHA',
];

function setEnv(values: Record<string, string | undefined>): void {
  // Node/bun env is process-global, but each test file runs isolated, so this restore
  // only needs to keep tests inside this file independent of each other.
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

type Handler = (request: Request) => Promise<Response>;

async function importEntry(cacheBust: string): Promise<Handler> {
  const module = await import(`../api/index.ts?entry=${cacheBust}`);
  const handler = (module.default as { fetch: Handler }).fetch;
  return (request) => handler.call(module.default, request);
}

const errorOf = async (response: Response) => (await response.json()) as { error: { code: string; message: string } };

test('a preview deployment refuses uploads', async () => {
  const entry = await importEntry('preview');
  setEnv({ VERCEL_ENV: 'preview', BLOB_READ_WRITE_TOKEN: 'tok', BLOB_ACCESS: 'private' });
  const response = await entry(new Request(`${ORIGIN}/plans?name=X&duration=1h`, {
    method: 'POST', headers: { 'content-type': 'text/html', 'x-vercel-forwarded-for': '203.0.113.9' }, body: PLAN,
  }));
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const error = await errorOf(response);
  expect(error.error.code).toBe('planny_not_configured');
  expect(error.error.message).toContain('Uploads are disabled on preview deployments.');
});

test('an unconfigured deployment fails closed, serves pages, and fails a startup purge', async () => {
  const entry = await importEntry('fail-closed');
  setEnv({ VERCEL_ENV: undefined, BLOB_READ_WRITE_TOKEN: undefined });

  const post = await entry(new Request(`${ORIGIN}/plans?name=X&duration=1h`, {
    method: 'POST', headers: { 'content-type': 'text/html' }, body: PLAN,
  }));
  expect(post.status).toBe(503);
  expect(post.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(post.headers.get('x-planny-build')).toBe('vercel');
  expect((await errorOf(post)).error.code).toBe('planny_not_configured');

  const gone = await entry(new Request(`${ORIGIN}/p/${UUID_A}`));
  expect(gone.status).toBe(503);
  expect(gone.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await gone.text()).toContain('planny is not configured yet');

  const malformed = await entry(new Request(`${ORIGIN}/p/not-a-uuid`));
  expect(malformed.status).toBe(404);
  expect(await malformed.text()).toContain('No plan at this link.');

  const method = await entry(new Request(`${ORIGIN}/plans`));
  expect(method.status).toBe(405);
  expect(method.headers.get('allow')).toBe('POST');
  expect((await errorOf(method)).error.code).toBe('method_not_allowed');

  // The unconfigured home fallback and the unknown-path 404 are served as pages.
  const home = await entry(new Request(ORIGIN));
  expect(home.status).toBe(200);
  expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(home.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600, must-revalidate');
  expect(home.headers.get('x-planny-build')).toBe('vercel');
  expect(await home.text()).toContain('planny');

  const unknown = await entry(new Request(`${ORIGIN}/nowhere`));
  expect(unknown.status).toBe(404);
  expect(unknown.headers.get('cache-control')).toBe('no-store');
  expect(await unknown.text()).toContain('404');

  const del = await entry(new Request(`${ORIGIN}/p/${UUID_A}`, { method: 'DELETE' }));
  expect(del.status).toBe(503);
  expect((await errorOf(del)).error.code).toBe('planny_not_configured');

  const put = await entry(new Request(`${ORIGIN}/p/${UUID_A}`, { method: 'PUT' }));
  expect(put.status).toBe(405);
  expect(put.headers.get('allow')).toBe('GET, HEAD');

  const headPlan = await entry(new Request(`${ORIGIN}/p/${UUID_A}`, { method: 'HEAD' }));
  expect(headPlan.status).toBe(503);
  // Bodies on HEAD are stripped by the edge runtime, so only the status is asserted here;
  // the app-level HEAD body test covers the bodyless contract.

  const health = await entry(new Request(`${ORIGIN}/health`));
  expect(health.status).toBe(200);
  expect(health.headers.get('cache-control')).toBe('no-store');
  const status = (await health.json()) as {
    ok: boolean; configured: boolean; purge: string; error: string | null; env: string | null;
    commit: string | null; runtime: string; flags: Record<string, boolean | string | null>;
  };
  expect(status.ok).toBe(true);
  expect(status.configured).toBe(false);
  // Reading /health itself warms config creation and records the failure message.
  expect(status.error).toBe('planny needs BLOB_READ_WRITE_TOKEN or PLANNY_ADDRESS_KEY.');
  expect(status.env).toBe(null);
  expect(status.commit).toBe(null);
  expect(status.purge).toBe('pending');
  expect(status.flags.blobToken).toBe(false);
  expect(status.flags.access).toBe(null);
  expect(status.flags.accessConfigured).toBe(false);
  expect(status.flags.addressKey).toBe(false);
  expect(status.flags.adminToken).toBe(false);
  expect(status.flags.blobKey).toBe(false);
  expect(status.runtime).toContain('bun');

  // Warm the app, then fail the purge: /health reports both facts.
  // Note the true failure semantics: once config creation fails, `failure` sticks and
  // the app is not rebuilt for this instance (a restart or new deployment rebuilds it).
  setEnv({ BLOB_READ_WRITE_TOKEN: 'tok', BLOB_ACCESS: 'private' });
  state.listShouldThrow = true;
  await entry(new Request(`${ORIGIN}/p/${UUID_A}`));
  const failed = await entry(new Request(`${ORIGIN}/health`));
  const failedStatus = (await failed.json()) as { configured: boolean; purge: string; error: string | null; flags: { blobToken: boolean; addressKey: boolean } };
  expect(failedStatus.configured).toBe(false);
  expect(failedStatus.purge).toBe('failed');
  expect(failedStatus.error).toBe('planny needs BLOB_READ_WRITE_TOKEN or PLANNY_ADDRESS_KEY.');
  expect(failedStatus.flags.blobToken).toBe(true);
  expect(failedStatus.flags.addressKey).toBe(false);
});

test('the warmed entry purges orphaned plan blobs once and serves real traffic', async () => {
  const entry = await importEntry('full');
  state.deletedTags.length = 0;
  state.listShouldThrow = false;
  state.files.clear();
  const purgeCallsBefore = state.purgeRequests;
  setEnv({
    VERCEL_ENV: 'production',
    BLOB_READ_WRITE_TOKEN: undefined,
    BLOB_ACCESS: undefined,
  });
  setEnv({
    VERCEL_ENV: 'production',
    BLOB_READ_WRITE_TOKEN: 'tok',
    BLOB_ACCESS: 'private',
    VERCEL_GIT_COMMIT_SHA: 'abc1234',
  });

  // Orphaned blobs left by an old deployment are picked up at startup.
  state.files.set(`plans/${UUID_A}.html`, 'stale');
  state.files.set(`plans/${UUID_B}.html`, 'stale');

  const health = await entry(new Request(`${ORIGIN}/health`));
  const status = (await health.json()) as {
    ok: boolean; configured: boolean; purge: string; commit: string | null; env: string | null;
    runtime: string; flags: Record<string, boolean | string | null>;
  };
  expect(status.ok).toBe(true);
  expect(status.configured).toBe(true);
  expect(status.purge).toBe('ok');
  expect(status.commit).toBe('abc1234');
  expect(status.env).toBe('production');
  expect(status.flags.blobToken).toBe(true);
  expect(status.flags.addressKey).toBe(false);
  expect(status.flags.adminToken).toBe(false);
  expect(status.runtime).toContain('bun');
  expect(state.purgeRequests).toBe(purgeCallsBefore + 1);
  expect(state.deletedTags).toEqual([`plan-${UUID_A}`, `plan-${UUID_B}`]);
  expect(state.files.size).toBe(0);

  // The purge is guarded by the module flag: later requests list nothing again.
  state.files.set(`plans/${UUID_A}.html`, 'stale-again');
  await entry(new Request(`${ORIGIN}/health`));
  expect(state.purgeRequests).toBe(purgeCallsBefore + 1);
  state.files.clear();

  const upload = await entry(new Request(`${ORIGIN}/plans?name=Entry&duration=1h`, {
    method: 'POST', headers: { 'content-type': 'text/html', 'x-vercel-forwarded-for': '203.0.113.9' }, body: PLAN,
  }));
  expect(upload.status).toBe(201);
  const plan = (await upload.json()) as { id: string; url: string };
  expect(plan.url.startsWith(`${ORIGIN}/p/`)).toBe(true);
  expect(state.files.has(`plans/${plan.id}.html`)).toBe(true);

  const view = await entry(new Request(plan.url, { headers: { 'x-vercel-forwarded-for': '203.0.113.1' } }));
  expect(view.status).toBe(200);
  expect(await view.text()).toContain('Entry');

  setEnv({ VERCEL_ENV: undefined, BLOB_READ_WRITE_TOKEN: undefined, BLOB_ACCESS: undefined, VERCEL_GIT_COMMIT_SHA: undefined });
});
