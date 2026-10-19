import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRecords } from '../src/records.js';
import { createLocalStore } from '../src/stores/local.js';
import { newClaimId, newPlanId, sha256Hex } from '../src/util.js';

const MIN = 60 * 1000;
const GENEROUS = { site: 1000, owner: 1000, monthlyUploads: 10 };

function fixture(limits = GENEROUS) {
  const dataDir = mkdtempSync(join(tmpdir(), 'planny-records-'));
  const store = createLocalStore({ dataDir });
  const records = createRecords(store.redis);
  const counter = async (key) => Number(await store.redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []));
  const reserve = (id, claimId, extra = {}) => records.reserve({
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
  return { dataDir, store, records, counter, reserve, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

test('a plan goes pending, live, removing and gone, and its bytes come back once', async () => {
  const f = fixture();
  try {
    const id = newPlanId();
    const claim = newClaimId();
    assert.equal(await f.reserve(id, claim), 'ok');
    assert.equal((await f.records.get(id)).state, 'pending');
    assert.equal(await f.counter('planny:site:bytes'), 100);
    assert.equal(await f.records.publish(id, claim, 10 * MIN), 'ok');
    assert.equal(await f.records.publish(id, claim, 10 * MIN), 'not_pending');
    assert.equal((await f.records.get(id)).state, 'live');
    const removal = newClaimId();
    assert.equal(await f.records.claim(id, { claimId: removal, now: 2000, reason: 'deleted', staleBefore: 0 }), 'ok');
    assert.equal(await f.records.finish(id, { claimId: removal, now: 2000, owner: 'owner-a' }), 'ok');
    assert.equal(await f.records.finish(id, { claimId: removal, now: 2000, owner: 'owner-a' }), 'not_removing');
    assert.equal(await f.counter('planny:site:bytes'), 0);
    assert.equal(await f.counter('planny:owner:owner-a:bytes'), 0);
    const rec = await f.records.get(id);
    assert.equal(rec.state, 'gone');
    assert.equal(rec.reason, 'deleted');
  } finally {
    f.cleanup();
  }
});

test('a refused reservation changes nothing', async () => {
  const f = fixture({ site: 150, owner: 1000, monthlyUploads: 10 });
  try {
    assert.equal(await f.reserve(newPlanId(), newClaimId()), 'ok');
    const second = newPlanId();
    assert.equal(await f.reserve(second, newClaimId()), 'site_budget');
    assert.equal(await f.records.get(second), null);
    assert.equal(await f.counter('planny:site:bytes'), 100);
  } finally {
    f.cleanup();
  }
});

test('the address budget and the monthly upload limit refuse too', async () => {
  const perAddress = fixture({ site: 10000, owner: 150, monthlyUploads: 10 });
  try {
    assert.equal(await perAddress.reserve(newPlanId(), newClaimId()), 'ok');
    assert.equal(await perAddress.reserve(newPlanId(), newClaimId()), 'owner_budget');
  } finally {
    perAddress.cleanup();
  }
  const monthly = fixture({ site: 10000, owner: 10000, monthlyUploads: 1 });
  try {
    assert.equal(await monthly.reserve(newPlanId(), newClaimId()), 'ok');
    assert.equal(await monthly.reserve(newPlanId(), newClaimId()), 'monthly_uploads');
  } finally {
    monthly.cleanup();
  }
});

test('a fresh claim is busy, a stale one can be taken over, and live plans wait for their time', async () => {
  const f = fixture();
  try {
    const pending = newPlanId();
    await f.reserve(pending, newClaimId());
    assert.equal(await f.records.claim(pending, { claimId: newClaimId(), now: 1500, reason: 'abandoned', staleBefore: 1500 - 15 * MIN }), 'busy');
    assert.equal(await f.records.claim(pending, { claimId: newClaimId(), now: 1500, reason: 'abandoned', staleBefore: 1000 }), 'ok');
    assert.equal((await f.records.get(pending)).reason, 'abandoned');

    const live = newPlanId();
    const claim = newClaimId();
    await f.reserve(live, claim, { expiresAt: 5000 });
    await f.records.publish(live, claim, 5000);
    assert.equal(await f.records.claim(live, { claimId: newClaimId(), now: 4000, reason: 'expired', staleBefore: 0 }), 'not_expired');
    assert.equal(await f.records.claim(live, { claimId: newClaimId(), now: 6000, reason: 'expired', staleBefore: 0 }), 'ok');
  } finally {
    f.cleanup();
  }
});

test('rate windows count hits and say when they reset', async () => {
  const f = fixture();
  try {
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await f.records.rate('views', 'owner-a', 1000, { max: 2, windowSeconds: 60 }));
    }
    assert.deepEqual(results.map((result) => result.allowed), [true, true, false]);
    assert.equal(results[2].retryAfter, 59);
  } finally {
    f.cleanup();
  }
});

test('monthly read limits refuse without counting the refused read', async () => {
  const f = fixture();
  try {
    const limits = { reads: 2, readBytes: 150 };
    assert.equal(await f.records.consumeMonthly(1000, 100, limits), 'ok');
    assert.equal(await f.records.consumeMonthly(1000, 100, limits), 'bytes');
    assert.equal(await f.records.consumeMonthly(1000, 10, limits), 'ok');
    assert.equal(await f.records.consumeMonthly(1000, 10, limits), 'reads');
  } finally {
    f.cleanup();
  }
});

test('records and counters survive a restart', async () => {
  const f = fixture();
  try {
    const id = newPlanId();
    await f.reserve(id, newClaimId());
    const reopened = createLocalStore({ dataDir: f.dataDir });
    assert.equal((await createRecords(reopened.redis).get(id)).state, 'pending');
    assert.equal(Number(await reopened.redis.eval("return redis.call('GET', KEYS[1]) or '0'", ['planny:site:bytes'], [])), 100);
  } finally {
    f.cleanup();
  }
});

test('concurrent reservations never overspend the budget', async () => {
  const f = fixture({ site: 1000, owner: 100000, monthlyUploads: 1000 });
  try {
    const results = await Promise.all(Array.from({ length: 25 }, () => f.reserve(newPlanId(), newClaimId())));
    assert.equal(results.filter((result) => result === 'ok').length, 10);
    assert.equal(await f.counter('planny:site:bytes'), 1000);
  } finally {
    f.cleanup();
  }
});
