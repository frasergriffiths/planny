import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { createRecords } from '../src/records.js';
import { createLocalStore } from '../src/stores/local.js';
import { newClaimId, newPlanId, sha256Hex } from '../src/util.js';

const MIN = 60_000;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(limits = { site: 1000, owner: 1000, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 }) {
  const dir = mkdtempSync(join(tmpdir(), 'planny-ts-'));
  dirs.push(dir);
  const store = createLocalStore({ dataDir: dir });
  const records = createRecords(store.redis);
  const counter = async (key: string): Promise<number> => Number(await store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []));
  const reserve = (id: string, claimId: string, extra: Partial<Parameters<typeof records.reserve>[0]> = {}) => records.reserve({
    id,
    claimId,
    now: 1000,
    owner: 'owner-a',
    bytes: 100,
    name: 'Plan',
    expiresAt: 10 * MIN,
    deleteKeyHash: sha256Hex('key'),
    limits,
    ...extra,
  });
  return { records, store, counter, reserve };
}

test('a plan moves through its states and bytes return once', async () => {
  const f = fixture();
  const id = newPlanId();
  const claim = newClaimId();
  expect(await f.reserve(id, claim)).toBe('ok');
  expect((await f.records.get(id))?.state).toBe('pending');
  expect(await f.counter('planny:site:bytes')).toBe(100);
  expect(await f.records.publish(id, claim, 10 * MIN)).toBe('ok');
  expect(await f.records.publish(id, claim, 10 * MIN)).toBe('not_pending');
  const removal = newClaimId();
  expect(await f.records.claim(id, { claimId: removal, now: 2000, reason: 'deleted', staleBefore: 0 })).toBe('ok');
  expect(await f.records.finish(id, { claimId: removal, now: 2000, owner: 'owner-a' })).toBe('ok');
  expect(await f.records.finish(id, { claimId: removal, now: 2000, owner: 'owner-a' })).toBe('not_removing');
  expect(await f.counter('planny:site:bytes')).toBe(0);
  expect(await f.counter('planny:owner:owner-a:bytes')).toBe(0);
  expect((await f.records.get(id))?.state).toBe('gone');
});

test('all limits refuse without counting', async () => {
  const site = fixture({ site: 150, owner: 1000, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 });
  expect(await site.reserve(newPlanId(), newClaimId())).toBe('ok');
  expect(await site.reserve(newPlanId(), newClaimId())).toBe('site_bytes');
  expect(await site.counter('planny:site:bytes')).toBe(100);

  const owner = fixture({ site: 10_000, owner: 150, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 });
  expect(await owner.reserve(newPlanId(), newClaimId())).toBe('ok');
  expect(await owner.reserve(newPlanId(), newClaimId())).toBe('owner_bytes');

  const monthly = fixture({ site: 10_000, owner: 10_000, monthlyUploads: 1, ownerMonthlyReadBytes: 1e9 });
  expect(await monthly.reserve(newPlanId(), newClaimId())).toBe('ok');
  expect(await monthly.reserve(newPlanId(), newClaimId())).toBe('monthly_uploads');

  // The address's read share is for views only: a full share must not stop an upload.
  const reader = fixture({ site: 10_000, owner: 10_000, monthlyUploads: 10, ownerMonthlyReadBytes: 0 });
  const id = newPlanId();
  expect(await reader.reserve(id, newClaimId())).toBe('ok');
  expect((await reader.records.get(id))?.state).toBe('pending');
});

test('the view step counts reads, bytes and the address share, then refuses', async () => {
  const f = fixture({ site: 1e9, owner: 1e9, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 });
  const id = newPlanId();
  await f.reserve(id, newClaimId());
  const view = (overrides: Partial<Parameters<typeof f.records.view>[0]> = {}) => f.records.view({
    id,
    now: 1000,
    bytes: 100,
    owner: 'owner-a',
    site: { reads: 2, readBytes: 1e9 },
    ownerReadBytes: 1000,
    alert: { perPlanHourly: 1000, monthlyWarningFraction: 0.5, counterTtlSeconds: 7200 },
    ...overrides,
  });
  expect(await view()).toEqual({ ok: true });
  expect(await view()).toEqual({ ok: true });
  expect(await view()).toEqual({ ok: false, guard: 'reads' });
  expect(await f.counter('planny:month:1970-01:bytes')).toBe(200);
  expect(await view({ site: { reads: 100, readBytes: 150 } })).toEqual({ ok: false, guard: 'bytes' });
  expect(await view({ site: { reads: 100, readBytes: 1e9 }, ownerReadBytes: 150 })).toEqual({ ok: false, guard: 'owner_bytes' });
});

test('the monthly warning is logged once', async () => {
  const f = fixture({ site: 1e9, owner: 1e9, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 });
  const id = newPlanId();
  await f.reserve(id, newClaimId());
  const base = {
    id,
    now: Date.UTC(2026, 10, 2, 9),
    bytes: 100,
    owner: 'owner-a',
    site: { reads: 1e9, readBytes: 340 },
    ownerReadBytes: 1e9,
    alert: { perPlanHourly: 1000, monthlyWarningFraction: 0.5, counterTtlSeconds: 7200 },
  } as const;
  expect((await f.records.view(base)).warning).toBeUndefined();
  expect((await f.records.view(base)).warning).toBe(true);
  expect((await f.records.view(base)).warning).toBeUndefined();
});

test('the per-plan alert fires once an hour', async () => {
  const f = fixture({ site: 1e9, owner: 1e9, monthlyUploads: 10, ownerMonthlyReadBytes: 1e9 });
  const id = newPlanId();
  await f.reserve(id, newClaimId());
  const base = {
    id,
    now: Date.UTC(2026, 9, 19, 12, 30),
    bytes: 100,
    owner: 'owner-a',
    site: { reads: 1e9, readBytes: 1e9 },
    ownerReadBytes: 1e9,
    alert: { perPlanHourly: 2, monthlyWarningFraction: 0.5, counterTtlSeconds: 7200 },
  } as const;
  expect((await f.records.view(base)).alert).toBeUndefined();
  expect((await f.records.view(base)).alert).toBeUndefined();
  const third = await f.records.view(base);
  expect(third.ok).toBe(true);
  expect(third.alert).toBe(3);
  expect((await f.records.view(base)).alert).toBeUndefined();
});

test('reserved records carry their fields', async () => {
  const f = fixture();
  const id = newPlanId();
  expect(await f.reserve(id, newClaimId())).toBe('ok');
  const record = await f.records.get(id);
  expect(record?.name).toBe('Plan');
  expect(record?.bytes).toBe(100);
  expect(record?.owner).toBe('owner-a');
  expect(record?.state).toBe('pending');
});

test('reset clears the month', async () => {
  const f = fixture();
  const id = newPlanId();
  await f.reserve(id, newClaimId());
  expect(await f.records.resetMonth(1000, 'uploads')).toMatchObject({ uploads: 1 });
  const after = await f.store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", ['planny:month:1970-01:uploads'], []);
  expect(Number(after)).toBe(0);
});

test('the upload gate reports daily and monthly caps without counting', async () => {
  const f = fixture();
  const owner = 'owner-gated';
  const now = Date.UTC(2026, 9, 20, 12);
  const daily = await f.records.uploadGate(owner, now, { spacingSeconds: 0, perDay: 0, perMonth: 500 }, newClaimId());
  expect(daily.ok).toBe(false);
  expect(daily.code).toBe('address_upload_daily_limit');
  expect(daily.retryAfter).toBeGreaterThan(0);
  expect(daily.retryAfter).toBeLessThanOrEqual(24 * 60 * 60);

  // A refusal never claims a slot: nothing was counted for the address or the day.
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(0);

  const monthly = await f.records.uploadGate(owner, now, { spacingSeconds: 0, perDay: 50, perMonth: 0 }, newClaimId());
  expect(monthly.ok).toBe(false);
  expect(monthly.code).toBe('address_upload_monthly_limit');
  expect(monthly.retryAfter).toBeGreaterThan(0);
});

test('the upload gate claims the slot and holds the spacing window', async () => {
  const f = fixture();
  const owner = 'owner-claimed';
  const now = Date.UTC(2026, 9, 20, 12);
  const first = newClaimId();
  expect(await f.records.uploadGate(owner, now, { spacingSeconds: 120, perDay: 50, perMonth: 500 }, first)).toEqual({ ok: true });
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(1);
  expect(await f.counter(`planny:upload:month:${owner}:2026-10`)).toBe(1);
  expect(await f.counter(`planny:upload:spacing:${owner}`)).toBe(now);

  // A second gate inside the spacing window waits, because the first claim owns the slot.
  const second = await f.records.uploadGate(owner, now + 1000, { spacingSeconds: 120, perDay: 50, perMonth: 500 }, newClaimId());
  expect(second.ok).toBe(false);
  expect(second.code).toBe('address_upload_rate_limited');
  expect(second.retryAfter).toBeGreaterThan(100);
  expect(second.retryAfter).toBeLessThanOrEqual(120);
});

test('release refunds a claimed slot and answers twice with nothing', async () => {
  const f = fixture();
  const owner = 'owner-refund';
  const now = Date.UTC(2026, 9, 20, 12);
  const values = { spacingSeconds: 120, perDay: 50, perMonth: 500 };
  const claim = newClaimId();
  expect(await f.records.uploadGate(owner, now, values, claim)).toEqual({ ok: true });

  // A refund from an unknown claim is an unanswered no-op.
  expect(await f.records.releaseUploadClaim(owner, newClaimId())).toBe('unknown');

  expect(await f.records.releaseUploadClaim(owner, claim)).toBe('ok');
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(0);
  expect(await f.counter(`planny:upload:month:${owner}:2026-10`)).toBe(0);
  expect(await f.counter(`planny:upload:spacing:${owner}`)).toBe(0);

  // A second release of the same claim is neutral, the record is gone.
  expect(await f.records.releaseUploadClaim(owner, claim)).toBe('unknown');

  // The refunded slot is claimable again, and a new claim has fresh values.
  const next = newClaimId();
  expect(await f.records.uploadGate(owner, now + 1000, values, next)).toEqual({ ok: true });
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(1);
  expect(await f.counter(`planny:upload:spacing:${owner}`)).toBe(now + 1000);
  // A released claim cannot refund twice: the newer claim's slot stays intact.
  expect(await f.records.releaseUploadClaim(owner, claim)).toBe('unknown');
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(1);
  expect(await f.counter(`planny:upload:spacing:${owner}`)).toBe(now + 1000);
});

test('the demo gate keeps its own counters and refunds them', async () => {
  const f = fixture();
  const owner = 'owner-demo-scope';
  const now = Date.UTC(2026, 9, 20, 12);
  const values = { spacingSeconds: 120, perDay: 2, perMonth: 5 };
  const claim = newClaimId();
  expect(await f.records.uploadGate(owner, now, values, claim, 'demo')).toEqual({ ok: true });

  // The demo claim charges only the demo counters; the ordinary upload gate is untouched.
  expect(await f.counter(`planny:upload:demo:day:${owner}:2026-10-20`)).toBe(1);
  expect(await f.counter(`planny:upload:demo:month:${owner}:2026-10`)).toBe(1);
  expect(await f.counter(`planny:upload:demo:spacing:${owner}`)).toBe(now);
  expect(await f.counter(`planny:upload:day:${owner}:2026-10-20`)).toBe(0);
  expect(await f.counter(`planny:upload:month:${owner}:2026-10`)).toBe(0);
  expect(await f.counter(`planny:upload:spacing:${owner}`)).toBe(0);

  // The claim record carries its scope, so the refund finds the demo counters again.
  expect(await f.records.releaseUploadClaim(owner, claim)).toBe('ok');
  expect(await f.counter(`planny:upload:demo:day:${owner}:2026-10-20`)).toBe(0);
  expect(await f.counter(`planny:upload:demo:month:${owner}:2026-10`)).toBe(0);
  expect(await f.counter(`planny:upload:demo:spacing:${owner}`)).toBe(0);
});

test('claims respect the daily cap, then the refunded slot frees the room', async () => {
  const f = fixture();
  const owner = 'owner-daily';
  const now = Date.UTC(2026, 9, 20, 12);
  const values = { spacingSeconds: 0, perDay: 2, perMonth: 50 };
  const a = newClaimId();
  const b = newClaimId();
  const c = newClaimId();
  expect(await f.records.uploadGate(owner, now, values, a)).toEqual({ ok: true });
  expect(await f.records.uploadGate(owner, now, values, b)).toEqual({ ok: true });
  const refused = await f.records.uploadGate(owner, now, values, c);
  expect(refused.ok).toBe(false);
  expect(refused.code).toBe('address_upload_daily_limit');

  expect(await f.records.releaseUploadClaim(owner, a)).toBe('ok');
  // Without the spacing floor the freed slot is claimable at once.
  expect(await f.records.uploadGate(owner, now, values, c)).toEqual({ ok: true });
});

test('a second concurrent claim loses the race and answers busy', async () => {
  const f = fixture();
  const id = newPlanId();
  const claim = newClaimId();
  expect(await f.reserve(id, claim)).toBe('ok');
  expect(await f.records.publish(id, claim, 10 * MIN)).toBe('ok');
  const first = newClaimId();
  expect(await f.records.claim(id, { claimId: first, now: 5000, reason: 'deleted', staleBefore: 0 })).toBe('ok');
  // A second claimer races the first fresh claim: the store answers busy, which the
  // app maps to HTTP 409.
  expect(await f.records.claim(id, { claimId: newClaimId(), now: 6000, reason: 'deleted', staleBefore: 0 })).toBe('busy');
  const record = await f.records.get(id);
  expect(record?.state).toBe('removing');
  expect(record?.claimId).toBe(first);
});
