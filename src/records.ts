import { z } from 'zod';
import { CLAIM, FINISH, PUBLISH, RATE, RESERVE, UPLOAD_CLAIM, UPLOAD_FINALIZE, UPLOAD_RELEASE, VIEW } from './lua.js';
import type { RedisLike } from './stores/local.js';

export interface PlanRecord {
  readonly id: string;
  readonly state: 'pending' | 'live' | 'removing' | 'gone';
  readonly name: string;
  readonly bytes: number;
  readonly owner: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly deleteKeyHash: string;
  readonly hidden: boolean;
  readonly claimId: string;
  readonly claimAt: number;
  readonly reason: string;
  readonly removedAt: number;
}

export type ReservationOutcome =
  | 'ok'
  | 'exists'
  | 'site_bytes'
  | 'owner_bytes'
  | 'monthly_uploads';

export type ViewGuard = 'reads' | 'bytes' | 'owner_bytes';

export interface ViewResult {
  readonly ok: boolean;
  readonly guard?: ViewGuard;
  readonly alert?: number;
  readonly warning?: boolean;
}

const recordSchema = z.object({
  id: z.string(),
  state: z.enum(['pending', 'live', 'removing', 'gone']),
  name: z.string(),
  bytes: z.coerce.number().int().nonnegative(),
  owner: z.string(),
  createdAt: z.coerce.number().int().nonnegative(),
  expiresAt: z.coerce.number().int().nonnegative(),
  deleteKeyHash: z.string(),
  hidden: z.string(),
  claimId: z.string(),
  claimAt: z.coerce.number().int().nonnegative(),
  reason: z.string(),
  removedAt: z.coerce.number().int().nonnegative(),
});

const viewResultSchema = z.object({
  ok: z.literal(true).optional(),
  guard: z.enum(['reads', 'bytes', 'owner_bytes']).optional(),
  alert: z.number().optional(),
  warning: z.literal(true).optional(),
});

const outcomeSchema = z.enum(['ok', 'exists', 'site_bytes', 'owner_bytes', 'monthly_uploads']);


function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextDayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function nextMonthStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export interface UploadGateResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly retryAfter?: number;
}

const EXPIRING = 'planny:expiring';
const CLAIMS = 'planny:claims';
const SITE_BYTES = 'planny:site:bytes';
const HOUR_MS = 60 * 60 * 1000;
// The claim record only needs to outlive an upload request. A crash loses the refund; the
// milestone self-cleans and re-check after the TTL rebuilds from whichever counters remain.
const CLAIM_TTL_SECONDS = 900;

const planKey = (id: string): string => `planny:plan:${id}`;
const ownerBytesKey = (owner: string): string => `planny:owner:${owner}:bytes`;
const ownerMonthlyKey = (month: string, owner: string): string => `planny:month:${month}:owner:${owner}:bytes`;

export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const monthKey = (month: string, what: string): string => `planny:month:${month}:${what}`;
const uploadSpacingKey = (owner: string): string => `planny:upload:spacing:${owner}`;
const uploadDayKey = (owner: string, now: number): string => `planny:upload:day:${owner}:${dayOf(now)}`;
const uploadMonthKey = (owner: string, now: number): string => `planny:upload:month:${owner}:${monthOf(now)}`;
const uploadClaimKey = (owner: string, claimId: string): string => `planny:upload:claim:${owner}:${claimId}`;

const claimRecordSchema = z.object({
  now: z.string().regex(/^\d+$/),
  day: z.string().regex(/^\d+$/),
  month: z.string().regex(/^\d+$/),
});

export function parseRecord(hash: Record<string, string> | null): PlanRecord | null {
  if (!hash || !hash.state) return null;
  const parsed = recordSchema.safeParse(hash);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    state: row.state,
    name: row.name,
    bytes: row.bytes,
    owner: row.owner,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    deleteKeyHash: row.deleteKeyHash,
    hidden: row.hidden === '1',
    claimId: row.claimId,
    claimAt: row.claimAt,
    reason: row.reason,
    removedAt: row.removedAt,
  };
}

export interface ReserveInput {
  readonly id: string;
  readonly claimId: string;
  readonly now: number;
  readonly owner: string;
  readonly bytes: number;
  readonly name: string;
  readonly expiresAt: number;
  readonly deleteKeyHash: string;
  /**
   * Which monthly upload counter this reservation charges. The homepage demo box has its
   * own counter, so its uploads never spend the site-wide `uploads` budget.
   */
  readonly uploadCounter?: 'uploads' | 'uploads:demo';
  readonly limits: {
    readonly site: number;
    readonly owner: number;
    readonly monthlyUploads: number;
  };
}

export interface MonthReset {
  readonly reads: number;
  readonly bytes: number;
  readonly uploads: number;
  readonly ownerBytes: number;
}

export function createRecords(redis: RedisLike) {
  async function get(id: string): Promise<PlanRecord | null> {
    return parseRecord(await redis.hgetall(planKey(id)));
  }

  async function reserve(input: ReserveInput): Promise<ReservationOutcome> {
    const month = monthOf(input.now);
    const fields: Record<string, string> = {
      state: 'pending',
      id: input.id,
      name: input.name,
      bytes: String(input.bytes),
      owner: input.owner,
      createdAt: String(input.now),
      expiresAt: String(input.expiresAt),
      deleteKeyHash: input.deleteKeyHash,
      hidden: '0',
      claimId: input.claimId,
      claimAt: String(input.now),
      reason: '',
      removedAt: '0',
    };
    const raw = await redis.eval(
      RESERVE,
      [
        planKey(input.id),
        SITE_BYTES,
        ownerBytesKey(input.owner),
        monthKey(month, input.uploadCounter ?? 'uploads'),
        CLAIMS,
      ],
      [
        String(input.bytes),
        String(input.limits.site),
        String(input.limits.owner),
        String(input.limits.monthlyUploads),
        input.id,
        String(input.now),
        ...Object.entries(fields).flat(),
      ],
    );
    return outcomeSchema.parse(raw);
  }

  async function publish(id: string, claimId: string, expiresAt: number): Promise<string> {
    return String(await redis.eval(PUBLISH, [planKey(id), CLAIMS, EXPIRING], [id, claimId, String(expiresAt)]));
  }

  async function claim(id: string, input: { claimId: string; now: number; reason: string; staleBefore: number }): Promise<string> {
    return String(await redis.eval(
      CLAIM,
      [planKey(id), CLAIMS, EXPIRING],
      [id, input.claimId, String(input.now), input.reason, String(input.staleBefore)],
    ));
  }

  async function finish(id: string, input: { claimId: string; now: number; owner: string }): Promise<string> {
    return String(await redis.eval(FINISH, [planKey(id), SITE_BYTES, ownerBytesKey(input.owner), CLAIMS], [id, input.claimId, String(input.now)]));
  }

  async function readNumber(key: string): Promise<number> {
    return Number(await redis.eval("return redis.call('GET', KEYS[1]) or '0'", [key], []));
  }

  async function uploadGate(
    owner: string,
    now: number,
    limits: { spacingSeconds: number; perDay: number; perMonth: number },
    claimId: string,
  ): Promise<UploadGateResult> {
    const keys = [
      uploadSpacingKey(owner),
      uploadDayKey(owner, now),
      uploadMonthKey(owner, now),
      uploadClaimKey(owner, claimId),
    ];
    const raw = String(await redis.eval(UPLOAD_CLAIM, keys, [
      String(limits.spacingSeconds * 1000),
      String(now),
      String(limits.perDay),
      String(limits.perMonth),
      String(limits.spacingSeconds),
      String(Math.max(1, Math.ceil((nextDayStart(now) - now) / 1000))),
      String(Math.max(1, Math.ceil((nextMonthStart(now) - now) / 1000))),
      String(CLAIM_TTL_SECONDS),
    ]));
    if (raw === 'ok') return { ok: true };
    if (raw === 'address_upload_rate_limited') {
      const spacing = Number(await readNumber(keys[0] ?? ''));
      return { ok: false, code: raw, retryAfter: Math.max(1, Math.ceil((spacing + limits.spacingSeconds * 1000 - now) / 1000)) };
    }
    if (raw === 'address_upload_daily_limit') {
      return { ok: false, code: raw, retryAfter: Math.max(1, Math.ceil((nextDayStart(now) - now) / 1000)) };
    }
    return { ok: false, code: raw, retryAfter: Math.max(1, Math.ceil((nextMonthStart(now) - now) / 1000)) };
  }

  // Reclaims one claimed slot after a failed upload. The claim record proves the slot is
  // still outstanding: once the claim is settled, a release is an unanswered no-op.
  async function releaseUploadClaim(owner: string, claimId: string): Promise<'ok' | 'unknown'> {
    const rawRecord = await redis.hgetall(uploadClaimKey(owner, claimId));
    if (!rawRecord) return 'unknown';
    const parsed = claimRecordSchema.safeParse(rawRecord);
    if (!parsed.success) return 'unknown';
    const claim = parsed.data;
    const at = Number(claim.now);
    const raw = await redis.eval(
      UPLOAD_RELEASE,
      [
        uploadClaimKey(owner, claimId),
        uploadSpacingKey(owner),
        uploadDayKey(owner, at),
        uploadMonthKey(owner, at),
      ],
      [claim.now, claim.day, claim.month],
    );
    return String(raw) === 'ok' ? 'ok' : 'unknown';
  }

  // The publish succeeded: the counters stay, only the claim record goes.
  async function finalizeUpload(owner: string, claimId: string): Promise<void> {
    await redis.eval(UPLOAD_FINALIZE, [uploadClaimKey(owner, claimId)], []);
  }

  async function rate(scope: string, owner: string, now: number, limit: { max: number; windowSeconds: number }) {
    const windowMs = limit.windowSeconds * 1000;
    const bucket = Math.floor(now / windowMs);
    const key = `planny:rate:${scope}:${owner}:${bucket}`;
    const count = Number(await redis.eval(RATE, [key], [String(limit.windowSeconds)]));
    return {
      allowed: count <= limit.max,
      count,
      retryAfter: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)),
    };
  }

  async function view(input: {
    id: string;
    now: number;
    bytes: number;
    owner: string;
    site: { reads: number; readBytes: number };
    ownerReadBytes: number;
    alert: { perPlanHourly: number; monthlyWarningFraction: number; counterTtlSeconds: number };
  }): Promise<ViewResult> {
    const month = monthOf(input.now);
    const hour = String(Math.floor(input.now / HOUR_MS));
    const raw = await redis.eval(
      VIEW,
      [
        monthKey(month, 'reads'),
        monthKey(month, 'bytes'),
        `planny:plan:${input.id}:reads`,
        ownerMonthlyKey(month, input.owner),
        `planny:alert:warn:${month}`,
        `planny:alert:plan:${input.id}:${hour}`,
      ],
      [
        String(input.site.reads),
        String(input.site.readBytes),
        String(input.bytes),
        String(input.ownerReadBytes),
        hour,
        String(input.alert.counterTtlSeconds),
        String(input.alert.monthlyWarningFraction),
        String(input.alert.perPlanHourly),
      ],
    );
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false };
      }
    }
    const result = viewResultSchema.safeParse(parsed);
    if (!result.success) return { ok: false };
    return {
      ok: result.data.ok === true,
      ...(result.data.guard ? { guard: result.data.guard } : {}),
      ...(result.data.alert !== undefined ? { alert: result.data.alert } : {}),
      ...(result.data.warning ? { warning: true } : {}),
    };
  }

  async function resetMonth(
    now: number,
    counter: 'reads' | 'bytes' | 'uploads' | 'owner' | 'all',
    owner?: string,
  ): Promise<MonthReset> {
    const month = monthOf(now);
    const ownerKeys = owner
      ? [
        `planny:upload:spacing:${owner}`,
        `planny:upload:day:${owner}:${dayOf(now)}`,
        `planny:upload:month:${owner}:${monthOf(now)}`,
        ownerMonthlyKey(month, owner),
      ]
      : [];
    const keysFor = (what: string): string[] => {
      if (what === 'reads') return [monthKey(month, 'reads')];
      if (what === 'bytes') return [monthKey(month, 'bytes'), `planny:alert:warn:${month}`];
      if (what === 'uploads') return [monthKey(month, 'uploads')];
      if (what === 'owner') return ownerKeys;
      return [];
    };
    const before = {
      reads: await readNumber(keysFor('reads')[0] ?? ''),
      bytes: await readNumber(keysFor('bytes')[0] ?? ''),
      uploads: await readNumber(keysFor('uploads')[0] ?? ''),
      ownerBytes: owner ? await readNumber(ownerMonthlyKey(month, owner)) : 0,
    };
    // With an owner, "all" clears only that address's keys and markers. Without one it clears
    // the site read counters too; stored bytes and the site uploads key always stay explicit.
    const reset = counter === 'all' ? (owner ? ['owner'] : ['reads', 'bytes', 'owner']) : [counter];
    for (const what of reset) {
      for (const key of keysFor(what)) {
        if (key) await redis.eval("redis.call('SET', KEYS[1], '0')\nreturn 'ok'", [key], []);
      }
    }
    return before;
  }

  return {
    get,
    reserve,
    publish,
    claim,
    finish,
    rate,
    uploadGate,
    releaseUploadClaim,
    finalizeUpload,
    view,
    resetMonth,
    expiredIds: (now: number, limit: number) => redis.zrangebyscore(EXPIRING, now, limit),
    staleIds: (staleBefore: number, limit: number) => redis.zrangebyscore(CLAIMS, staleBefore, limit),
  };
}
