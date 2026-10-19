import { waitUntil } from '@vercel/functions';
import { createVercelApp } from '../src/vercel.js';
import { loadConfig } from '../src/config.js';
import { home, notConfigured, notFound, unknownPath } from '../src/pages.js';

// Vercel's Bun runtime runs this file as the function behind the rewrite in vercel.json.
// The app is built lazily, so a missing setting produces the designed 503, not a load crash.
let app: ReturnType<typeof createVercelApp> | null = null;
let failure: string | null = null;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' && !app) {
      const body = home({ build: 'vercel', origin: 'https://planny-pink.vercel.app', config: loadConfig() });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=0, s-maxage=3600, must-revalidate',
          'x-planny-build': 'vercel',
        },
      });
    }
    if (url.pathname === '/health') {
      const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : `node ${process.version}`;
      return new Response(`${JSON.stringify({ ok: true, configured: app !== null, runtime })}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (!app && !failure) {
      try {
        app = createVercelApp({ env: process.env, waitUntil });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        console.error('planny: configuration is incomplete at startup:', failure);
      }
    }
    if (!app) {
      const method = request.method.toUpperCase();
      const pageHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-planny-build': 'vercel' };
      const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-planny-build': 'vercel' };
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (url.pathname === '/plans') {
        if (method !== 'POST') {
          return new Response(`${JSON.stringify({ error: { code: 'method_not_allowed', message: 'Upload a plan with POST /plans.' } })}\n`, {
            status: 405, headers: { ...jsonHeaders, allow: 'POST' },
          });
        }
        return new Response(`${JSON.stringify({ error: { code: 'planny_not_configured', message: 'planny is not configured yet. Try again later.' } })}\n`, { status: 503, headers: jsonHeaders });
      }
      if (url.pathname.startsWith('/p/')) {
        const id = url.pathname.slice(3).replace(/\/$/, '');
        if (method !== 'GET' && method !== 'HEAD') {
          if (method === 'DELETE') {
            return new Response(`${JSON.stringify({ error: { code: 'planny_not_configured', message: 'planny is not configured yet. Try again later.' } })}\n`, { status: 503, headers: jsonHeaders });
          }
          return new Response(`${JSON.stringify({ error: { code: 'method_not_allowed', message: 'Read a plan with GET, or delete it with DELETE.' } })}\n`, {
            status: 405, headers: { ...jsonHeaders, allow: 'GET, HEAD' },
          });
        }
        if (!uuid.test(id.toLowerCase())) {
          return new Response(notFound({ build: 'vercel' }), { status: 404, headers: pageHeaders });
        }
        // A plan link renders a page, even when the store is missing; only the API returns JSON.
        return new Response(notConfigured({ build: 'vercel' }), { status: 503, headers: pageHeaders });
      }
      return new Response(unknownPath({ build: 'vercel' }), { status: 404, headers: pageHeaders });

    }
    const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    return app.fetch(request, { address: forwarded || 'unknown' });
  },
};
