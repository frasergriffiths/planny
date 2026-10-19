import * as pages from './pages.js';
import { createRecords } from './records.js';
import { sanitize } from './sanitize.js';
import { ApiError, checkHtmlType, parseDuration, parseName } from './validate.js';
import {
  isPlanId,
  newClaimId,
  newDeleteKey,
  newPlanId,
  ownerKey,
  sameText,
  sha256Hex,
} from './util.js';

const MiB = 1024 * 1024;
const NEVER = Number.MAX_SAFE_INTEGER;
const PLAN_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; "
  + "form-action 'none'; frame-ancestors 'none'";
const SITE_CSP = "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; "
  + "form-action 'none'; frame-ancestors 'none'";

export function createApp({ build, store, config, secret, origin, now = () => Date.now(), log = console, waitUntil }) {
  const records = createRecords(store.redis);
  const mib = (bytes) => `${bytes / MiB} MiB`;
  const ownerOf = (address) => ownerKey(secret, address);

  function background(task) {
    const safe = Promise.resolve(task).catch((error) => log.error('planny: background task failed', error));
    if (waitUntil) waitUntil(safe);
  }

  function pageResponse(status, html, method, headers = {}) {
    return new Response(method === 'HEAD' ? null : html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': SITE_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'x-planny-build': build,
        ...headers,
      },
    });
  }

  function jsonResponse(status, body, headers = {}) {
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

  function planHeaders(id, ttl) {
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

  const tooLarge = () => new ApiError(
    413,
    'too_large',
    `Plans are capped at ${pages.sizeText(config.maxBodyBytes)}, including embedded images. Make the file smaller and upload it again.`,
  );

  async function uploadsAllowed() {
    try {
      return await store.control.uploadsEnabled();
    } catch (error) {
      log.error('planny: could not read the upload switch, so uploads are paused', error);
      return false;
    }
  }

  async function readBody(request) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > config.maxBodyBytes) throw tooLarge();
    if (!request.body) throw new ApiError(400, 'empty_body', 'Send the HTML plan as the request body.');
    const reader = request.body.getReader();
    const chunks = [];
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

  function reservationError(outcome, at) {
    if (outcome === 'site_budget') {
      return new ApiError(503, 'storage_full', 'planny has no room for new plans right now. Try again later.');
    }
    if (outcome === 'owner_budget') {
      return new ApiError(
        429,
        'storage_limit',
        `This address already stores ${mib(config.ownerStoredBytes)} of plans, its limit. Delete a plan to make room.`,
      );
    }
    if (outcome === 'monthly_uploads') {
      return new ApiError(
        503,
        'uploads_monthly_limit',
        `planny has used its uploads for this month. Uploads resume ${pages.formatUtc(pages.nextMonthStart(at))}.`,
      );
    }
    log.error('planny: unexpected reservation result', outcome);
    return new ApiError(500, 'upload_failed', 'The upload could not start. Upload it again.');
  }

  async function removePlan(id, reason, at, { force = false } = {}) {
    const rec = await records.get(id);
    if (!rec) return 'missing';
    const claimId = newClaimId();
    const staleBefore = force ? NEVER : at - config.claimStaleMs;
    const claimed = await records.claim(id, { claimId, now: at, reason, staleBefore });
    if (claimed !== 'ok') return claimed;
    try {
      await store.blobs.remove(id);
    } catch (error) {
      log.error('planny: could not delete a plan file, so the sweep will finish it', error);
      return 'cleanup_pending';
    }
    return records.finish(id, { claimId, now: at, owner: rec.owner });
  }

  async function settle(id, reason, at) {
    try {
      return await removePlan(id, reason, at);
    } catch (error) {
      log.error(`planny: could not finish removing ${id}`, error);
      return 'error';
    }
  }

  async function sweep({ limit = config.sweepBatch } = {}) {
    const at = now();
    const results = [];
    for (const id of await records.expiredIds(at, limit)) {
      results.push({ id, reason: 'expired', outcome: await settle(id, 'expired', at) });
    }
    for (const id of await records.staleIds(at - config.claimStaleMs, limit)) {
      const rec = await records.get(id);
      if (!rec) continue;
      const reason = rec.state === 'pending' ? 'abandoned' : rec.reason || 'abandoned';
      results.push({ id, reason, outcome: await settle(id, reason, at) });
    }
    return results;
  }

  async function upload(request, url, address) {
    if (!(await uploadsAllowed())) {
      throw new ApiError(503, 'uploads_paused', 'Uploads are paused right now. Try again later.');
    }
    const at = now();
    const owner = ownerOf(address);
    const limit = await records.rate('uploads', owner, at, config.rateLimits.uploads);
    if (!limit.allowed) {
      throw new ApiError(
        429,
        'rate_limited',
        `Too many uploads from this address. Wait ${limit.retryAfter} seconds.`,
        { 'retry-after': String(limit.retryAfter) },
      );
    }
    checkHtmlType(request.headers.get('content-type'));
    const name = parseName(url.searchParams.get('name'), config.maxNameLength);
    const durationMs = parseDuration(url.searchParams.get('duration'), config);
    const raw = await readBody(request);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new ApiError(400, 'invalid_encoding', 'The plan must be UTF-8 text.');
    }
    let cleaned;
    try {
      cleaned = sanitize(text, build === 'local' ? { localLabel: name } : {});
    } catch (error) {
      if (error.code === 'too_deep') {
        throw new ApiError(400, 'too_deep', 'The plan nests elements too deeply. Keep nesting under 200 levels.');
      }
      throw error;
    }
    const bytes = Buffer.from(cleaned.html, 'utf8');
    if (bytes.byteLength > config.maxBodyBytes) throw tooLarge();

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
        site: config.siteStoredBytes,
        owner: config.ownerStoredBytes,
        monthlyUploads: config.monthly.uploads,
      },
    };
    let reserved = await records.reserve(reservation);
    if (reserved === 'site_budget' || reserved === 'owner_budget') {
      await sweep({ limit: 50 }).catch((error) => log.error('planny: sweep before retry failed', error));
      reserved = await records.reserve(reservation);
    }
    if (reserved !== 'ok') throw reservationError(reserved, at);

    try {
      await store.blobs.put(id, bytes);
    } catch (error) {
      log.error('planny: could not store the plan file', error);
      await removePlan(id, 'abandoned', at, { force: true })
        .catch((cleanupError) => log.error('planny: rollback failed', cleanupError));
      throw new ApiError(500, 'upload_failed', 'The plan did not reach storage, so nothing was kept. Upload it again.');
    }

    if ((await records.publish(id, claimId, expiresAt)) !== 'ok') {
      throw new ApiError(500, 'upload_interrupted', 'The upload was cancelled before it went live. Upload it again.');
    }
    background(sweep());
    return jsonResponse(201, {
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

  function unavailable(rec, method) {
    if (rec.hidden || rec.reason === 'takedown') {
      return pageResponse(410, pages.takedown({ build, removedAt: rec.removedAt }), method);
    }
    if (rec.reason === 'deleted') {
      return pageResponse(410, pages.deleted({ build, removedAt: rec.removedAt }), method);
    }
    if (rec.reason === 'expired' || rec.state === 'live') {
      return pageResponse(410, pages.expired({ build, expiresAt: rec.expiresAt }), method);
    }
    return pageResponse(404, pages.notFound({ build }), method);
  }

  async function view(id, method, address, withQuery = false) {
    const at = now();
    const limit = await records.rate('views', ownerOf(address), at, config.rateLimits.views);
    if (!limit.allowed) {
      return pageResponse(
        429,
        pages.rateLimited({ build, retryAfter: limit.retryAfter }),
        method,
        { 'retry-after': String(limit.retryAfter) },
      );
    }
    if (withQuery || !isPlanId(id)) return pageResponse(404, pages.notFound({ build }), method);
    const rec = await records.get(id);
    if (!rec || rec.state === 'pending') return pageResponse(404, pages.notFound({ build }), method);
    if (rec.state === 'live' && !rec.hidden && rec.expiresAt > at) {
      const consumed = await records.consumeMonthly(at, rec.bytes, config.monthly);
      if (consumed !== 'ok') {
        return pageResponse(503, pages.paused({ build, resumesAt: pages.nextMonthStart(at) }), method);
      }
      const html = await store.blobs.get(id);
      if (!html) {
        log.error(`planny: plan ${id} has a record but no file`);
        return pageResponse(500, pages.serverError({ build }), method);
      }
      const ttl = Math.max(1, Math.min(config.cacheTtlSeconds, Math.floor((rec.expiresAt - at) / 1000)));
      return new Response(method === 'HEAD' ? null : html, { status: 200, headers: planHeaders(id, ttl) });
    }
    if (rec.state === 'live' && !rec.hidden) background(removePlan(id, 'expired', at));
    return unavailable(rec, method);
  }

  async function remove(id, request, address) {
    const at = now();
    const limit = await records.rate('deletes', ownerOf(address), at, config.rateLimits.deletes);
    if (!limit.allowed) {
      throw new ApiError(
        429,
        'rate_limited',
        `Too many delete attempts from this address. Wait ${limit.retryAfter} seconds.`,
        { 'retry-after': String(limit.retryAfter) },
      );
    }
    const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!key) throw new ApiError(401, 'missing_key', 'Send the delete key as Authorization: Bearer <deleteKey>.');
    const rec = isPlanId(id) ? await records.get(id) : null;
    if (!rec || rec.state === 'pending') throw new ApiError(404, 'no_plan', 'No plan at this link.');
    if (rec.state !== 'live') throw new ApiError(410, 'already_removed', 'This plan was already removed.');
    if (!sameText(sha256Hex(key), rec.deleteKeyHash)) {
      throw new ApiError(403, 'wrong_key', 'That delete key does not match this plan.');
    }
    const outcome = await removePlan(id, 'deleted', at);
    if (outcome === 'busy') {
      throw new ApiError(409, 'busy', 'This plan is already being removed. Check again in a moment.');
    }
    if (outcome === 'gone' || outcome === 'missing') {
      throw new ApiError(410, 'already_removed', 'This plan was already removed.');
    }
    background(store.purge(id));
    return jsonResponse(200, { deleted: true, id });
  }

  async function takedown(id) {
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

  async function handle(request, { address = 'unknown' } = {}) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const api = url.pathname === '/plans' || (url.pathname.startsWith('/p/') && method !== 'GET' && method !== 'HEAD');
    try {
      if (url.pathname === '/' && (method === 'GET' || method === 'HEAD')) {
        const ttl = config.cacheTtlSeconds;
        return pageResponse(200, pages.home({ build, origin, config }), method, {
          'cache-control': `public, max-age=0, s-maxage=${ttl}, must-revalidate`,
          'vercel-cdn-cache-control': `s-maxage=${ttl}`,
        });
      }
      if (url.pathname === '/plans') {
        if (method !== 'POST') {
          throw new ApiError(405, 'method_not_allowed', 'Upload a plan with POST /plans.', { allow: 'POST' });
        }
        return await upload(request, url, address);
      }
      const match = /^\/p\/([^/]+)$/.exec(url.pathname);
      if (match && (method === 'GET' || method === 'HEAD')) {
        return await view(match[1], method, address, url.search !== '');
      }
      if (match && method === 'DELETE') return await remove(match[1], request, address);
      if (match) {
        throw new ApiError(405, 'method_not_allowed', 'Read a plan with GET, or delete it with DELETE.', {
          allow: 'GET, HEAD, DELETE',
        });
      }
      return pageResponse(404, pages.unknownPath({ build }), method);
    } catch (error) {
      if (error instanceof ApiError) {
        return api
          ? jsonResponse(error.status, { error: { code: error.code, message: error.message } }, error.headers)
          : pageResponse(500, pages.serverError({ build }), method);
      }
      log.error('planny: request failed', error);
      return api
        ? jsonResponse(500, { error: { code: 'server_error', message: 'planny hit an error. Try again in a minute.' } })
        : pageResponse(500, pages.serverError({ build }), method);
    }
  }

  return { handle, takedown, sweep, records };
}
