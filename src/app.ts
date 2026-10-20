import { Hono, type Context } from 'hono';
import * as pages from './pages.js';
import { PAGES } from './generated-pages.js';
import { createRecords, type PlanRecord } from './records.js';
import { SanitizeTooDeepError, sanitize } from './sanitize.js';
import type { AppConfig } from './config.js';
import type { Store } from './stores/local.js';
import { ApiError, badType, isHtmlType, parseDuration } from './validate.js';
import { StoreUnavailableError } from './stores/blob.js';
import {
  escapeHtml,
  isPlanId,
  newClaimId,
  newDeleteKey,
  newPlanId,
  ownerKey,
  sameText,
  sha256Hex,
} from './util.js';
import { z } from 'zod';

const MiB = 1024 * 1024;
const NEVER = Number.MAX_SAFE_INTEGER;
const PLAN_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; "
  + "form-action 'none'; frame-ancestors 'none'";
const SITE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
  + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SAMPLE_CSP = PLAN_CSP.replace('sandbox;', "sandbox allow-top-navigation-by-user-activation;");
const SAMPLE_CTA = '<div style="position:fixed;right:20px;bottom:20px;z-index:10;font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;font-weight:600;">'
  + '<a href="/" style="display:inline-block;padding:10px 14px;border:1px solid #3f3f3f;border-radius:4px;background:#0a0a0a;color:#f5f5f5;text-decoration:none;">Make your own plan</a></div>';

function samplePage(): string {
  return PAGES.sample.replace('</body>', `${SAMPLE_CTA}\n</body>`);
}

export interface Logger {
  error(...args: unknown[]): void;
  alert(message: string, fields: Record<string, string | number>): void;
}

export interface AppDeps {
  readonly build: 'local' | 'vercel';
  readonly store: Store;
  readonly config: AppConfig;
  readonly secret: string;
  readonly origin: string;
  readonly adminToken?: string;
  readonly now?: () => number;
  readonly log?: Logger;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

export type AppEnv = {
  Variables: {
    address: string;
  };
};

const nameSchema = z.string().max(10_000).transform((value) => value
  .normalize('NFC')
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim())
  .refine((value) => value.length > 0, 'empty')
  .refine((value) => [...value].length <= 120, 'long');

const querySchema = z.object({
  name: z.string().optional(),
  duration: z.string().optional(),
});

const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const bearerSchema = z.string().regex(/^Bearer\s+\S+$/i);

const deleteKeySchema = z.string().min(1);

const adminResetSchema = z.object({
  counter: z.enum(['reads', 'bytes', 'uploads', 'owner', 'all']),
});

export interface App extends Hono<AppEnv> {
  sweep(options?: { limit?: number }): Promise<Array<{ id: string; reason: string; outcome: string }>>;
  takedown(id: string): Promise<{ outcome: string; purged: boolean }>;
  resetMonth(counter: 'reads' | 'bytes' | 'uploads' | 'owner' | 'all'): Promise<{ reads: number; bytes: number; uploads: number }>;
}

function injectPlanFooter(html: string): string {
  const footer = '<div style="margin:2.5rem 0 0;padding:1rem 0;border-top:1px solid rgba(255,255,255,.14);'
    + 'color:#a1a1a1;font:400 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">Published by planny</div>';
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`);
  return `${html}${footer}`;
}

export function createApp(deps: AppDeps): App {
  const { build, store, config, secret, origin, adminToken, now = () => Date.now() } = deps;
  const log: Logger = deps.log ?? { error: (...args) => console.error(...args), alert: () => {} };
  const records = createRecords(store.redis);
  const app = new Hono<AppEnv>();
  const mib = (bytes: number): string => `${bytes / MiB} MiB`;

  function background(task: Promise<unknown>): void {
    const safe = task.catch((error: unknown) => log.error('planny: background task failed', error));
    if (deps.waitUntil) deps.waitUntil(safe);
  }

  function page(status: number, html: string, headers: Record<string, string> = {}): Response {
    return new Response(html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': SITE_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        ...(status === 410 ? { 'x-robots-tag': 'noindex' } : {}),
        'x-planny-build': build,
        ...headers,
      },
    });
  }

  function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(`${JSON.stringify(body, null, 2)}\n`, {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-planny-build': build,
        ...headers,
      },
    });
  }

  function rawHeaders(id: string, ttl: number): Record<string, string> {
    return {
      ...planHeaders(id, ttl),
      'content-security-policy': PLAN_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
      'x-robots-tag': 'noindex',
    };
  }

  function planHeaders(id: string, ttl: number): Record<string, string> {
    return {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': PLAN_CSP,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'cache-control': `public, max-age=0, s-maxage=${ttl}, must-revalidate`,
      'vercel-cdn-cache-control': `s-maxage=${ttl}`,
      'vercel-cache-tag': `plan-${id}`,
      'x-planny-build': build,
    };
  }

  function tooLarge(): ApiError {
    return new ApiError(
      413,
      'too_large',
      `Plans are capped at ${pages.sizeText(config.maxBodyBytes)}, including embedded images. Make the file smaller and upload it again.`,
    );
  }

  async function uploadsAllowed(): Promise<boolean> {
    try {
      return await store.control.uploadsEnabled();
    } catch (error) {
      log.error('planny: could not read the upload switch, so uploads are paused', error);
      return false;
    }
  }

  async function readBody(request: Request): Promise<Buffer> {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > config.maxBodyBytes) throw tooLarge();
    if (!request.body) throw new ApiError(400, 'empty_body', 'Send the HTML plan as the request body.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > config.maxBodyBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    if (total === 0) throw new ApiError(400, 'empty_body', 'Send the HTML plan as the request body.');
    return Buffer.concat(chunks, total);
  }

  function reservationError(outcome: string, at: number): ApiError {
    if (outcome === 'site_bytes') {
      return new ApiError(503, 'storage_full', 'planny has no room for new plans right now. Try again later.');
    }
    if (outcome === 'owner_bytes') {
      return new ApiError(
        429,
        'storage_limit',
        `This address already stores its share of ${mib(config.ownerBytes)}. Delete a plan to make room.`,
      );
    }
    if (outcome === 'monthly_uploads') {
      return new ApiError(
        503,
        'site_upload_monthly_limit',
        `planny has used its 5,000 uploads for this month. Uploads resume ${pages.formatUtc(pages.nextMonthStart(at))}.`,
      );
    }
    log.error('planny: unexpected reservation result', outcome);
    return new ApiError(500, 'upload_failed', 'The upload could not start. Upload it again.');
  }

  async function removePlan(id: string, reason: string, at: number, options: { force?: boolean } = {}): Promise<string> {
    const record = await records.get(id);
    if (!record) return 'missing';
    const claimId = newClaimId();
    const staleBefore = options.force ? NEVER : at - config.claimStaleMs;
    const claimed = await records.claim(id, { claimId, now: at, reason, staleBefore });
    if (claimed !== 'ok') return claimed;
    try {
      await store.blobs.remove(id);
    } catch (error) {
      log.error('planny: could not delete a plan file, so the sweep will finish it', error);
      return 'cleanup_pending';
    }
    return records.finish(id, { claimId, now: at, owner: record.owner });
  }

  async function settle(id: string, reason: string, at: number): Promise<string> {
    try {
      return await removePlan(id, reason, at);
    } catch (error) {
      log.error(`planny: could not finish removing ${id}`, error);
      return 'error';
    }
  }

  async function sweep(options: { limit?: number } = {}): Promise<Array<{ id: string; reason: string; outcome: string }>> {
    const at = now();
    const limit = options.limit ?? config.sweepBatch;
    const results: Array<{ id: string; reason: string; outcome: string }> = [];
    for (const id of await records.expiredIds(at, limit)) {
      results.push({ id, reason: 'expired', outcome: await settle(id, 'expired', at) });
    }
    for (const id of await records.staleIds(at - config.claimStaleMs, limit)) {
      const record = await records.get(id);
      if (!record) continue;
      const reason = record.state === 'pending' ? 'abandoned' : record.reason || 'abandoned';
      results.push({ id, reason, outcome: await settle(id, reason, at) });
    }
    return results;
  }

  async function upload(request: Request, address: string): Promise<Response> {
    if (!(await uploadsAllowed())) {
      throw new ApiError(503, 'uploads_paused', 'Uploads are paused right now. Try again later.');
    }
    const at = now();
    const owner = ownerKey(secret, address);
    const gate = await records.uploadGate(owner, at, {
      spacingSeconds: config.uploadSpacingSeconds,
      perDay: config.uploadsPerDay,
      perMonth: config.uploadsPerMonth,
    });
    if (!gate.ok) {
      const code = gate.code ?? 'address_upload_rate_limited';
      const seconds = gate.retryAfter ?? 60;
      const messages: Record<string, string> = {
        address_upload_rate_limited: `One upload at a time from this address. Wait ${seconds} seconds before the next.`,
        address_upload_daily_limit: `This address has uploaded its 50 plans for today. Uploads resume at midnight UTC.`,
        address_upload_monthly_limit: `This address has uploaded its 500 plans this month. Uploads resume ${pages.formatUtc(pages.nextMonthStart(at))}.`,
      };
      throw new ApiError(429, code, messages[code] ?? `Try again in ${seconds} seconds.`, {
        'retry-after': String(seconds),
      });
    }
    if (!isHtmlType(request.headers.get('content-type'))) throw badType();
    const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsedQuery.success) throw new ApiError(400, 'invalid_query', 'Use ?name= and ?duration= only.');
    const parsedName = nameSchema.safeParse(parsedQuery.data.name ?? '');
    if (!parsedName.success) {
      const empty = parsedName.error.issues.some((issue) => issue.message === 'empty');
      throw empty
        ? new ApiError(400, 'name_required', 'Add a name with ?name=. Example: name=Q4%20rollout')
        : new ApiError(400, 'name_too_long', 'Names can be up to 120 characters.');
    }
    const name = parsedName.data;
    const durationMs = parseDuration(parsedQuery.data.duration ?? null, config);
    const raw = await readBody(request);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new ApiError(400, 'invalid_encoding', 'The plan must be UTF-8 text.');
    }
    let cleaned: { html: string; removed: Record<string, number> };
    try {
      cleaned = sanitize(text, { mode: build });
    } catch (error) {
      if (error instanceof SanitizeTooDeepError) {
        throw new ApiError(400, 'too_deep', 'The plan nests elements too deeply. Keep nesting under 200 levels.');
      }
      throw error;
    }
    // The cap is the raw body, checked before cleaning; the stored wrapper is a few dozen bytes.
    const bytes = Buffer.from(cleaned.html, 'utf8');

    const id = newPlanId();
    const claimId = newClaimId();
    const deleteKey = newDeleteKey();
    const expiresAt = at + durationMs;
    const reservation = {
      id,
      claimId,
      now: at,
      owner,
      bytes: bytes.byteLength,
      name,
      expiresAt,
      deleteKeyHash: sha256Hex(deleteKey),
      limits: {
        site: config.siteBytes,
        owner: config.ownerBytes,
        monthlyUploads: config.monthly.uploads,
      },
    } as const;
    let reserved = await records.reserve(reservation);
    if (reserved === 'site_bytes' || reserved === 'owner_bytes') {
      await sweep({ limit: 50 }).catch((error: unknown) => log.error('planny: sweep before retry failed', error));
      reserved = await records.reserve(reservation);
    }
    if (reserved !== 'ok') throw reservationError(reserved, at);

    try {
      await store.blobs.put(id, bytes);
    } catch (error) {
      log.error('planny: could not store the plan file', error);
      await removePlan(id, 'abandoned', at, { force: true })
        .catch((cleanup: unknown) => log.error('planny: rollback failed', cleanup));
      throw new ApiError(500, 'upload_failed', 'The plan did not reach storage, so nothing was kept. Upload it again.');
    }

    if ((await records.publish(id, claimId, expiresAt)) !== 'ok') {
      throw new ApiError(500, 'upload_interrupted', 'The upload was cancelled before it went live. Upload it again.');
    }
    await records.uploadRecord(owner, at, {
      spacingSeconds: config.uploadSpacingSeconds,
      perDay: config.uploadsPerDay,
      perMonth: config.uploadsPerMonth,
    });
    background(sweep());
    return json(201, {
      id,
      name,
      build,
      url: `${origin}/p/${id}`,
      expiresAt: new Date(expiresAt).toISOString(),
      bytes: bytes.byteLength,
      deleteKey,
      delete: { method: 'DELETE', url: `${origin}/p/${id}`, header: 'Authorization: Bearer <deleteKey>' },
      removed: cleaned.removed,
    });
  }

  function unavailable(record: PlanRecord): Response {
    const gone = { 'x-robots-tag': 'noindex' };
    if (record.hidden || record.reason === 'takedown') {
      return page(410, build === 'vercel' ? PAGES.gone : pages.takedown({ build, removedAt: record.removedAt }), gone);
    }
    if (record.reason === 'deleted') {
      return page(410, build === 'vercel' ? PAGES.gone : pages.deleted({ build, removedAt: record.removedAt }), gone);
    }
    if (record.reason === 'expired' || record.state === 'live') {
      return page(410, build === 'vercel' ? PAGES.gone : pages.expired({ build, expiresAt: record.expiresAt, name: record.name }), gone);
    }
    return page(404, build === 'vercel' ? PAGES.notFound : pages.notFound({ build }));
  }

  async function view(rawId: string, request: Request, address: string, withQuery: boolean, raw = false): Promise<Response> {
    const id = rawId.toLowerCase();
    const at = now();
    const limit = await records.rate('views', ownerKey(secret, address), at, config.rateLimits.views);
    if (!limit.allowed) {
      return page(429, build === 'vercel' ? PAGES.gone : pages.rateLimited({ build, retryAfter: limit.retryAfter }), { 'retry-after': String(limit.retryAfter) });
    }
    if (withQuery || !isPlanId(id)) return page(404, build === 'vercel' ? PAGES.notFound : pages.notFound({ build }));
    const record = await records.get(id);
    if (!record || record.state === 'pending') return page(404, build === 'vercel' ? PAGES.notFound : pages.notFound({ build }));
    if (record.state === 'live' && !record.hidden && record.expiresAt > at) {
      const result = await records.view({
        id,
        now: at,
        bytes: record.bytes,
        owner: record.owner,
        site: { reads: config.monthly.reads, readBytes: config.monthly.readBytes },
        ownerReadBytes: config.ownerMonthlyReadBytes,
        alert: config.planReadAlert,
      });
      if (result.warning) {
        log.alert('planny: half of the monthly read budget is used', { month: new Date(at).toISOString().slice(0, 7) });
      }
      if (result.alert !== undefined) {
        log.alert('planny: plan origin reads passed the hourly threshold', {
          plan: id,
          hour: new Date(at).toISOString().slice(0, 13),
          originReads: result.alert,
        });
      }
      if (!result.ok) {
        return page(503, pages.paused({
          build,
          guard: result.guard ?? 'reads',
          resumesAt: pages.nextMonthStart(at),
        }));
      }
      const html = await store.blobs.get(id);
      if (!html) {
        log.error(`planny: plan ${id} has a record but no file`);
        return page(500, pages.serverError({ build }));
      }
      const ttl = Math.max(1, Math.min(config.cacheTtlSeconds, Math.floor((record.expiresAt - at) / 1000)));
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(html), { status: 200, headers: rawHeaders(id, ttl) });
    }
    if (record.state === 'live' && !record.hidden) background(removePlan(id, 'expired', at));
    return unavailable(record);
  }

  async function remove(id: string, request: Request, address: string): Promise<Response> {
    const at = now();
    const limit = await records.rate('deletes', ownerKey(secret, address), at, config.rateLimits.deletes);
    if (!limit.allowed) {
      throw new ApiError(429, 'rate_limited', `Too many delete attempts from this address. Wait ${limit.retryAfter} seconds.`, {
        'retry-after': String(limit.retryAfter),
      });
    }
    const auth = request.headers.get('authorization') ?? '';
    if (!bearerSchema.safeParse(auth).success) {
      throw new ApiError(401, 'missing_key', 'Send the delete key as Authorization: Bearer <deleteKey>.');
    }
    const keyResult = deleteKeySchema.safeParse(auth.replace(/^Bearer\s+/i, ''));
    if (!keyResult.success) throw new ApiError(401, 'missing_key', 'Send the delete key as Authorization: Bearer <deleteKey>.');
    const record = isPlanId(id) ? await records.get(id) : null;
    if (!record || record.state === 'pending') throw new ApiError(404, 'no_plan', 'No plan at this link.');
    if (record.state !== 'live') throw new ApiError(410, 'already_removed', 'This plan was already removed.');
    if (!sameText(sha256Hex(keyResult.data), record.deleteKeyHash)) {
      throw new ApiError(403, 'wrong_key', 'That delete key does not match this plan.');
    }
    const outcome = await removePlan(id, 'deleted', at);
    if (outcome === 'busy') throw new ApiError(409, 'busy', 'This plan is already being removed. Check again in a moment.');
    if (outcome === 'gone' || outcome === 'missing') throw new ApiError(410, 'already_removed', 'This plan was already removed.');
    background(store.purge(id));
    return json(200, { deleted: true, id });
  }

  async function takedown(id: string): Promise<{ outcome: string; purged: boolean }> {
    if (!isPlanId(id)) throw new Error('Not a plan id.');
    const outcome = await removePlan(id, 'takedown', now());
    try {
      await store.purge(id);
      return { outcome, purged: true };
    } catch (error) {
      log.error('planny: cache purge failed, so the page may stay cached until its cache time', error);
      return { outcome, purged: false };
    }
  }

  const adminResetSchema = z.object({
    counter: z.enum(['reads', 'bytes', 'uploads', 'owner', 'all']),
    owner: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  });

  async function resetMonth(
    counter: 'reads' | 'bytes' | 'uploads' | 'owner' | 'all',
    owner?: string,
  ): Promise<{ reads: number; bytes: number; uploads: number; ownerBytes: number }> {
    return records.resetMonth(now(), counter, owner);
  }

  // The rate limit runs before the token check, so wrong guesses cost the same as right ones.
  // Every call is logged with the action, plan, outcome and hashed address; the token never is.
  async function adminGuard(
    request: Request,
    address: string,
    action: string,
    planId?: string,
  ): Promise<{ ok: true } | { ok: false; status: 401 | 429; code: string; message: string; headers?: Record<string, string> }> {
    const hashed = ownerKey(secret, address);
    const at = now();
    const limit = await records.rate('admin', hashed, at, config.rateLimits.admin);
    if (!limit.allowed) {
      log.alert('planny: admin call rate limited', { action, ...(planId ? { plan: planId } : {}), address: hashed, outcome: 'rate_limited' });
      return {
        ok: false,
        status: 429,
        code: 'rate_limited',
        message: `Too many admin calls from this address. Wait ${limit.retryAfter} seconds.`,
        headers: { 'retry-after': String(limit.retryAfter) },
      };
    }
    const provided = request.headers.get('authorization') ?? '';
    const accepted = Boolean(adminToken) && sameText(provided, `Bearer ${adminToken}`);
    log.alert('planny: admin call', {
      action,
      ...(planId ? { plan: planId } : {}),
      address: hashed,
      outcome: accepted ? 'accepted' : 'unauthorized',
    });
    if (!accepted) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Send the admin token as Authorization: Bearer <token>.',
      };
    }
    return { ok: true };
  }

  app.use('*', async (c, next) => {
    const env = c.env as { address?: string } | undefined;
    c.set('address', env?.address ?? 'unknown');
    await next();
  });

  app.onError((error, c) => {
    const api = c.req.path === '/plans'
      || c.req.path.startsWith('/admin/')
      || (c.req.path.startsWith('/p/') && c.req.method !== 'GET' && c.req.method !== 'HEAD');
    if (error instanceof StoreUnavailableError) {
      return api
        ? json(503, { error: { code: 'store_unavailable', message: 'The plan store is unavailable. Try again in 5 seconds.' } }, { 'retry-after': '5' })
        : page(503, pages.paused({ build, guard: 'reads', resumesAt: now() + 5000 }), { 'retry-after': '5' });
    }
    if (error instanceof ApiError) {
      return api
        ? json(error.status, { error: { code: error.code, message: error.message } }, error.headers)
        : page(500, pages.serverError({ build }));
    }
    log.error('planny: request failed', error);
    return api
      ? json(500, { error: { code: 'server_error', message: 'planny hit an error. Try again in a minute.' } })
      : page(500, pages.serverError({ build }));
  });

  app.get('/', (c) => {
    const ttl = config.cacheTtlSeconds;
    return page(200, build === 'vercel' ? PAGES.home : pages.home({ build, origin, config }), {
      'cache-control': `public, max-age=0, s-maxage=${ttl}, must-revalidate`,
      'vercel-cdn-cache-control': `s-maxage=${ttl}`,
    });
  });
  app.on(['HEAD'], '/', (c) => c.body(null, 200, { 'content-type': 'text/html; charset=utf-8' }));

  app.get('/sample', () => page(200, samplePage(), { 'content-security-policy': SAMPLE_CSP }));
  app.get('/terms-of-use', () => page(200, PAGES.terms));
  app.get('/robots.txt', (c) => c.text(PAGES.robots, 200, {
    'cache-control': `public, max-age=0, s-maxage=${config.cacheTtlSeconds}, must-revalidate`,
  }));
  app.get('/sitemap.xml', (c) => c.text(PAGES.sitemap, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': `public, max-age=0, s-maxage=${config.cacheTtlSeconds}, must-revalidate`,
  }));

  // Uncached, so a deploy check can read the raw x-vercel-id from the response headers.
  app.get('/health', () => json(200, {
    ok: true,
    build,
    sha: process.env.PLANNY_SHA ?? 'unknown',
    runtime: `bun ${Bun.version}`,
  }));

  app.post('/plans', async (c) => upload(c.req.raw, c.get('address')) as Promise<Response>);
  app.all('/plans', () => {
    throw new ApiError(405, 'method_not_allowed', 'Upload a plan with POST /plans.', { allow: 'POST' });
  });

  app.get('/p/:id/raw', (c) => c.redirect(`/p/${c.req.param('id')}`, 301));
  app.on(['HEAD'], '/p/:id/raw', (c) => c.body(null, 301, { location: `/p/${c.req.param('id')}` }));
  app.get('/p/:id', (c) => view(c.req.param('id'), c.req.raw, c.get('address'), new URL(c.req.url).search !== ''));
  app.on(['HEAD'], '/p/:id', (c) => view(c.req.param('id'), c.req.raw, c.get('address'), new URL(c.req.url).search !== ''));
  app.delete('/p/:id', (c) => remove(c.req.param('id'), c.req.raw, c.get('address')));
  app.all('/p/:id', () => {
    throw new ApiError(405, 'method_not_allowed', 'Read a plan with GET, or delete it with DELETE.', { allow: 'GET, HEAD, DELETE' });
  });

  app.post('/admin/plans/:id/remove', async (c) => {
    const id = c.req.param('id');
    // The guard runs first, so even a malformed id is audited and rate limited.
    const guard = await adminGuard(c.req.raw, c.get('address'), 'takedown', id);
    if (!guard.ok) return json(guard.status, { error: { code: guard.code, message: guard.message } }, guard.headers);
    if (!uuidSchema.safeParse(id).success) {
      log.alert('planny: admin call', { action: 'takedown', plan: id, outcome: 'invalid_id' });
      return json(404, { error: { code: 'no_plan', message: 'No plan at this link.' } });
    }
    const result = await takedown(id);
    log.alert('planny: admin takedown finished', { action: 'takedown', plan: id, outcome: result.outcome, purged: String(result.purged) });
    return json(200, result);
  });

  app.post('/admin/reset', async (c) => {
    const guard = await adminGuard(c.req.raw, c.get('address'), 'reset');
    if (!guard.ok) return json(guard.status, { error: { code: guard.code, message: guard.message } }, guard.headers);
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = adminResetSchema.safeParse(body);
    if (!parsed.success) {
      return json(400, { error: { code: 'invalid_reset', message: 'Send {"counter":"reads"|"bytes"|"uploads"|"owner"|"all"}, and owner for owner.' } });
    }
    if (parsed.data.counter === 'owner' && !parsed.data.owner) {
      return json(400, { error: { code: 'invalid_reset', message: 'An owner reset needs the hashed address in "owner".' } });
    }
    const before = await resetMonth(parsed.data.counter, parsed.data.owner);
    log.alert('planny: admin reset', { action: 'reset', counter: parsed.data.counter, ...(parsed.data.owner ? { owner: parsed.data.owner } : {}), outcome: 'ok' });
    return json(200, { reset: parsed.data.counter, before });
  });
  app.notFound(() => page(404, build === 'vercel' ? PAGES.notFound : pages.unknownPath({ build })));

  return Object.assign(app, { sweep, takedown, resetMonth, records });
}
