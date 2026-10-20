export const MiB = 1024 * 1024;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const YEAR_MS = 365 * DAY_MS;

export interface RateLimit {
  max: number;
  windowSeconds: number;
}

export interface MonthlyLimits {
  uploads: number;
  reads: number;
  readBytes: number;
}

export interface PlanReadAlert {
  perPlanHourly: number;
  monthlyWarningFraction: number;
  counterTtlSeconds: number;
}

export interface AppConfig {
  maxBodyBytes: number;
  maxPlanYears: number;
  maxPlanMs: number;
  minPlanMs: number;
  defaultPlanMs: number;
  maxNameLength: number;
  siteBytes: number;
  ownerBytes: number;
  ownerMonthlyReadBytes: number;
  uploadSpacingSeconds: number;
  uploadsPerDay: number;
  uploadsPerMonth: number;
  monthly: MonthlyLimits;
  rateLimits: {
    uploads: RateLimit;
    views: RateLimit;
    deletes: RateLimit;
    admin: RateLimit;
  };
  claimStaleMs: number;
  cacheTtlSeconds: number;
  sweepBatch: number;
  planReadAlert: PlanReadAlert;
}

export type Env = Record<string, string | undefined>;

function setting(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const maxPlanYears = setting(env.PLANNY_MAX_PLAN_YEARS, 100);
  return {
    maxBodyBytes: 4 * MiB,
    maxPlanYears,
    maxPlanMs: maxPlanYears * YEAR_MS,
    minPlanMs: HOUR_MS,
    defaultPlanMs: 30 * DAY_MS,
    maxNameLength: 120,
    siteBytes: setting(env.PLANNY_SITE_BYTES, 100 * 1024 * MiB),
    ownerBytes: setting(env.PLANNY_OWNER_BYTES, 1024 * MiB),
    ownerMonthlyReadBytes: setting(env.PLANNY_OWNER_MONTHLY_READ_BYTES, 10 * 1024 * MiB),
    uploadSpacingSeconds: setting(env.PLANNY_UPLOAD_SPACING_SECONDS, 120),
    uploadsPerDay: setting(env.PLANNY_UPLOADS_PER_DAY, 50),
    uploadsPerMonth: setting(env.PLANNY_UPLOADS_PER_MONTH, 500),
    monthly: {
      uploads: setting(env.PLANNY_MONTHLY_UPLOADS, 5000),
      reads: setting(env.PLANNY_MONTHLY_READS, 1_500_000),
      readBytes: setting(env.PLANNY_MONTHLY_READ_BYTES, 200 * 1024 * MiB),
    },
    rateLimits: {
      uploads: { max: setting(env.PLANNY_RATE_UPLOADS_MAX, 20), windowSeconds: setting(env.PLANNY_RATE_UPLOADS_WINDOW, 3600) },
      views: { max: setting(env.PLANNY_RATE_VIEWS_MAX, 20), windowSeconds: setting(env.PLANNY_RATE_VIEWS_WINDOW, 60) },
      deletes: { max: 60, windowSeconds: 3600 },
      admin: { max: 10, windowSeconds: 60 },
    },
    claimStaleMs: setting(env.PLANNY_CLAIM_STALE_SECONDS, 900) * 1000,
    cacheTtlSeconds: setting(env.PLANNY_CACHE_TTL_SECONDS, 3600),
    sweepBatch: 20,
    planReadAlert: {
      perPlanHourly: 1000,
      monthlyWarningFraction: 0.5,
      counterTtlSeconds: 7200,
    },
  };
}
