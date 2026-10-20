import { randomUUID } from 'node:crypto';
import { expect, test } from 'bun:test';
import { blobPlanPath, createBlobStore } from '../src/stores/blob.js';

// These are the only tests that touch a real Vercel Blob store. The five live tests skip
// without a token and are excluded from CI's normal run; CI has no token, so they skip.
const token = process.env.BLOB_READ_WRITE_TOKEN ?? '';
const liveTest = test.skipIf(token === '');
const access = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';

function liveStore() {
  const pathKey = process.env.PLANNY_BLOB_KEY_1;
  return createBlobStore({
    token,
    access,
    prefix: `test-${randomUUID()}/`,
    ...(pathKey ? { pathKey } : {}),
  });
}

liveTest('the upload switch round-trips through the live store', async () => {
  const store = liveStore();
  await store.control.setUploadsEnabled(false);
  expect(await store.control.uploadsEnabled()).toBe(false);
  await store.control.setUploadsEnabled(true);
  expect(await store.control.uploadsEnabled()).toBe(true);
});

liveTest('a plan blob round-trips and is removed', async () => {
  const store = liveStore();
  const id = randomUUID();
  const bytes = new TextEncoder().encode('<!doctype html><h1>live</h1>');
  await store.blobs.put(id, bytes);
  expect(Array.from((await store.blobs.get(id)) ?? [])).toEqual(Array.from(bytes));
  await store.blobs.remove(id);
  expect(await store.blobs.get(id)).toBeNull();
});

liveTest('state values round-trip through the live store', async () => {
  const store = liveStore();
  const key = `live:${randomUUID()}`;
  await store.redis.eval("return redis.call('SET', KEYS[1], ARGV[1])", [key], ['live-value']);
  expect(await store.redis.eval("return redis.call('GET', KEYS[1])", [key], [])).toBe('live-value');
  await store.redis.eval("return redis.call('DEL', KEYS[1])", [key], []);
  expect(await store.redis.eval("return redis.call('GET', KEYS[1])", [key], [])).toBeNull();
});

liveTest('purging a tag with no cached plan is safe', async () => {
  const store = liveStore();
  await expect(store.purge(randomUUID())).resolves.toBeUndefined();
});

liveTest('the public plan path is stable and keyed', () => {
  expect(blobPlanPath('00000000-0000-4000-8000-000000000000', 'one'))
    .toBe(blobPlanPath('00000000-0000-4000-8000-000000000000', 'one'));
  expect(blobPlanPath('00000000-0000-4000-8000-000000000000', 'one'))
    .not.toBe(blobPlanPath('00000000-0000-4000-8000-000000000000', 'two'));
});
