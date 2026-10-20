import { expect, test } from 'bun:test';
import { DAY_MS, HOUR_MS, MiB, YEAR_MS, loadConfig, type AppConfig } from '../src/config.js';
import { notConfigured, serverError } from '../src/pages.js';

// Fallback table: unset and empty values fall back, zero is honoured, and negative,
// NaN and Infinity values fall back. Each scalar setting is driven through all cases.
interface Scalar {
  key: string;
  read: (config: AppConfig) => number;
  fallback: number;
}

const scalars: Array<Scalar> = [
  { key: 'PLANNY_MAX_PLAN_YEARS', read: (config) => config.maxPlanYears, fallback: 100 },
  { key: 'PLANNY_SITE_BYTES', read: (config) => config.siteBytes, fallback: 100 * 1024 * MiB },
  { key: 'PLANNY_OWNER_BYTES', read: (config) => config.ownerBytes, fallback: 1024 * MiB },
  { key: 'PLANNY_OWNER_MONTHLY_READ_BYTES', read: (config) => config.ownerMonthlyReadBytes, fallback: 10 * 1024 * MiB },
  { key: 'PLANNY_UPLOAD_SPACING_SECONDS', read: (config) => config.uploadSpacingSeconds, fallback: 120 },
  { key: 'PLANNY_UPLOADS_PER_DAY', read: (config) => config.uploadsPerDay, fallback: 50 },
  { key: 'PLANNY_UPLOADS_PER_MONTH', read: (config) => config.uploadsPerMonth, fallback: 500 },
  { key: 'PLANNY_MONTHLY_UPLOADS', read: (config) => config.monthly.uploads, fallback: 5000 },
  { key: 'PLANNY_MONTHLY_READS', read: (config) => config.monthly.reads, fallback: 1_500_000 },
  { key: 'PLANNY_MONTHLY_READ_BYTES', read: (config) => config.monthly.readBytes, fallback: 200 * 1024 * MiB },
  { key: 'PLANNY_CLAIM_STALE_SECONDS', read: (config) => config.claimStaleMs / 1000, fallback: 900 },
  { key: 'PLANNY_CACHE_TTL_SECONDS', read: (config) => config.cacheTtlSeconds, fallback: 3600 },
  { key: 'PLANNY_RATE_UPLOADS_MAX', read: (config) => config.rateLimits.uploads.max, fallback: 20 },
  { key: 'PLANNY_RATE_UPLOADS_WINDOW', read: (config) => config.rateLimits.uploads.windowSeconds, fallback: 3600 },
  { key: 'PLANNY_RATE_VIEWS_MAX', read: (config) => config.rateLimits.views.max, fallback: 20 },
  { key: 'PLANNY_RATE_VIEWS_WINDOW', read: (config) => config.rateLimits.views.windowSeconds, fallback: 60 },
];

const values = ['unset', '', '-5', 'NaN', 'Infinity', '0', '7'];

test('numeric settings fall back on unset, empty, negative, NaN and Infinity, and honour zero', () => {
  for (const scalar of scalars) {
    for (const value of values) {
      const env = { [scalar.key]: value === 'unset' ? undefined : value };
      const config = loadConfig(env);
      const expectsFallback = value === 'unset' || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0;
      const expected = expectsFallback ? scalar.fallback : Number(value);
      expect(scalar.read(config), `${scalar.key}=${value}`).toBe(expected);
    }
  }
});

test('the derived plan windows and defaults follow their sources', () => {
  const two = loadConfig({ PLANNY_MAX_PLAN_YEARS: '2' });
  expect(two.maxPlanMs).toBe(2 * YEAR_MS);
  expect(loadConfig({ PLANNY_MAX_PLAN_YEARS: 'bogus' }).maxPlanMs).toBe(100 * YEAR_MS);
  expect(loadConfig({}).maxBodyBytes).toBe(4 * MiB);
  expect(loadConfig({}).minPlanMs).toBe(HOUR_MS);
  expect(loadConfig({}).defaultPlanMs).toBe(30 * DAY_MS);
  expect(loadConfig({}).maxNameLength).toBe(120);
  expect(loadConfig({}).rateLimits.deletes).toEqual({ max: 60, windowSeconds: 3600 });
  expect(loadConfig({}).rateLimits.admin).toEqual({ max: 10, windowSeconds: 60 });
  expect(loadConfig({}).planReadAlert).toEqual({ perPlanHourly: 1000, monthlyWarningFraction: 0.5, counterTtlSeconds: 7200 });
  expect(loadConfig({}).sweepBatch).toBe(20);
});

test('the notConfigured and serverError pages render their own status', () => {
  const configured = notConfigured({ build: 'local' });
  expect(configured).toContain('planny is not configured yet.');
  expect(configured).toContain('<dd>Not configured</dd>');
  expect(configured).toContain('<dd>503</dd>');

  const broken = serverError({ build: 'vercel' });
  expect(broken).toContain('This plan could not be loaded.');
  expect(broken).toContain('<dd>Server error</dd>');
  expect(broken).toContain('<dd>500</dd>');
});
