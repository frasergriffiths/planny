import { SCRIPTS } from './lua.js';

const EXPIRING = 'planny:expiring';
const CLAIMS = 'planny:claims';
const SITE_BYTES = 'planny:site:bytes';

const planKey = (id) => `planny:plan:${id}`;
const ownerBytesKey = (owner) => `planny:owner:${owner}:bytes`;

export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
const monthKey = (ms, what) => `planny:month:${monthOf(ms)}:${what}`;

function parseRecord(hash) {
  return {
    id: hash.id ?? '',
    state: hash.state,
    name: hash.name ?? '',
    bytes: Number(hash.bytes ?? 0),
    owner: hash.owner ?? '',
    createdAt: Number(hash.createdAt ?? 0),
    expiresAt: Number(hash.expiresAt ?? 0),
    deleteKeyHash: hash.deleteKeyHash ?? '',
    hidden: hash.hidden === '1',
    claimId: hash.claimId ?? '',
    claimAt: Number(hash.claimAt ?? 0),
    reason: hash.reason ?? '',
    removedAt: Number(hash.removedAt ?? 0),
  };
}

// Record operations. Each one is a single Lua step, so the same logic runs in both builds.
export function createRecords(redis) {
  return {
    async get(id) {
      const hash = await redis.hgetall(planKey(id));
      return hash && hash.state ? parseRecord(hash) : null;
    },
    reserve({ id, claimId, now, owner, bytes, name, expiresAt, deleteKeyHash, limits }) {
      const fields = {
        state: 'pending',
        id,
        name,
        bytes: String(bytes),
        owner,
        createdAt: String(now),
        expiresAt: String(expiresAt),
        deleteKeyHash,
        hidden: '0',
        claimId,
        claimAt: String(now),
        reason: '',
        removedAt: '0',
      };
      return redis.eval(
        SCRIPTS.reserve,
        [planKey(id), SITE_BYTES, ownerBytesKey(owner), monthKey(now, 'uploads'), CLAIMS],
        [
          String(bytes),
          String(limits.site),
          String(limits.owner),
          String(limits.monthlyUploads),
          id,
          String(now),
          ...Object.entries(fields).flat(),
        ],
      );
    },
    publish(id, claimId, expiresAt) {
      return redis.eval(SCRIPTS.publish, [planKey(id), CLAIMS, EXPIRING], [id, claimId, String(expiresAt)]);
    },
    claim(id, { claimId, now, reason, staleBefore }) {
      return redis.eval(
        SCRIPTS.claim,
        [planKey(id), CLAIMS, EXPIRING],
        [id, claimId, String(now), reason, String(staleBefore)],
      );
    },
    finish(id, { claimId, now, owner }) {
      return redis.eval(SCRIPTS.finish, [planKey(id), SITE_BYTES, ownerBytesKey(owner), CLAIMS], [id, claimId, String(now)]);
    },
    async rate(scope, owner, now, { max, windowSeconds }) {
      const windowMs = windowSeconds * 1000;
      const bucket = Math.floor(now / windowMs);
      const key = `planny:rate:${scope}:${owner}:${bucket}`;
      const count = Number(await redis.eval(SCRIPTS.rate, [key], [String(windowSeconds)]));
      return {
        allowed: count <= max,
        count,
        retryAfter: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)),
      };
    },
    consumeMonthly(now, bytes, limits) {
      return redis.eval(
        SCRIPTS.consume,
        [monthKey(now, 'reads'), monthKey(now, 'bytes')],
        [String(limits.reads), String(limits.readBytes), String(bytes)],
      );
    },
    expiredIds(now, limit) {
      return redis.zrangebyscore(EXPIRING, now, limit);
    },
    staleIds(staleBefore, limit) {
      return redis.zrangebyscore(CLAIMS, staleBefore, limit);
    },
  };
}
