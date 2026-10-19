export const MiB = 1024 * 1024;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const YEAR_MS = 365 * DAY_MS;

function setting(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function loadConfig(env = process.env) {
  const maxPlanYears = setting(env.PLANNY_MAX_PLAN_YEARS, 100);
  return {
    maxBodyBytes: 4 * MiB,
    maxPlanYears,
    maxPlanMs: maxPlanYears * YEAR_MS,
    minPlanMs: HOUR_MS,
    defaultPlanMs: 30 * DAY_MS,
    maxNameLength: 120,
    siteStoredBytes: setting(env.PLANNY_SITE_BYTES, 800 * MiB),
    ownerStoredBytes: setting(env.PLANNY_OWNER_BYTES, 40 * MiB),
    monthly: {
      uploads: setting(env.PLANNY_MONTHLY_UPLOADS, 1500),
      reads: setting(env.PLANNY_MONTHLY_READS, 8000),
      readBytes: setting(env.PLANNY_MONTHLY_READ_BYTES, 8e9),
    },
    rateLimits: {
      uploads: { max: setting(env.PLANNY_RATE_UPLOADS_MAX, 20), windowSeconds: setting(env.PLANNY_RATE_UPLOADS_WINDOW, 3600) },
      views: { max: setting(env.PLANNY_RATE_VIEWS_MAX, 600), windowSeconds: setting(env.PLANNY_RATE_VIEWS_WINDOW, 60) },
      deletes: { max: 60, windowSeconds: 3600 },
    },
    claimStaleMs: setting(env.PLANNY_CLAIM_STALE_SECONDS, 900) * 1000,
    cacheTtlSeconds: setting(env.PLANNY_CACHE_TTL_SECONDS, 300),
    sweepBatch: 20,
  };
}
