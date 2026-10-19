import { waitUntil } from '@vercel/functions';
import { createVercelApp } from '../src/vercel.js';
import { loadConfig } from '../src/config.js';
import { home, unknownPath } from '../src/pages.js';

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
      const runtime = typeof Bun !== 'undefined' ? `bun ${Bun.version}` : 'unknown';
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
      const planPath = /^\/p\/[^/]+$/.test(url.pathname);
      const api = url.pathname === '/plans' || url.pathname.startsWith('/admin/')
        || (planPath && request.method !== 'GET' && request.method !== 'HEAD');
      // A plan view needs the store; any other path is just a 404 and must not claim misconfiguration.
      if (!api && !planPath) {
        return new Response(unknownPath({ build: 'vercel' }), {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-planny-build': 'vercel' },
        });
      }
      return api
        ? new Response(`${JSON.stringify({ error: { code: 'planny_not_configured', message: 'planny is not configured yet. Try again later.' } })}\n`, {
          status: 503,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        })
        : new Response('<!doctype html><html><head><meta charset="utf-8"><title>Not configured | planny</title></head>'
          + '<body style="margin:0;background:#000;color:#f5f5f5;font:16px/1.6 ui-sans-serif,system-ui;padding:10vh 8vw">'
          + '<p style="font:600 12px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#4d9fff">Not configured</p>'
          + '<h1 style="font-size:2rem;letter-spacing:-.03em">planny is not configured yet.</h1>'
          + '<p style="color:#a1a1a1;max-width:38rem">The deployment is missing its storage settings. Reads and uploads start once they are set.</p>'
          + '</body></html>', {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
    }
    const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    return app.fetch(request, { address: forwarded || 'unknown' });
  },
};
