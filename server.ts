// The one entry. Vercel's Bun preset runs this file with VERCEL set and starts the Vercel app;
// every other run starts the local app on 127.0.0.1. Bun.serve is called exactly once.
import { serve } from 'bun';
import { waitUntil } from '@vercel/functions';
import { createVercelApp } from './src/vercel.js';

const isVercel = Boolean(process.env.VERCEL);

const config = isVercel ? vercelConfig() : (await import('./local/server.js')).localServeConfig();

export const server = serve(config as Parameters<typeof serve>[0]);

if (isVercel) {
  console.log(`planny Vercel entry listening on http://127.0.0.1:${server.port} (Bun ${Bun.version})`);
} else {
  console.log(`planny local build listening on http://127.0.0.1:${server.port} (Bun ${Bun.version})`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.stop();
      process.exit(0);
    });
  }
}

function vercelConfig() {
  let app: ReturnType<typeof createVercelApp> | null = null;
  try {
    app = createVercelApp({ env: process.env, waitUntil });
  } catch (error) {
    console.error('planny: configuration is incomplete at startup:', error instanceof Error ? error.message : error);
  }
  return {
    port: Number(process.env.PORT ?? 3000),
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return new Response(`${JSON.stringify({ ok: app !== null, configured: app !== null, runtime: `bun ${Bun.version}` })}\n`, {
          status: app ? 200 : 503,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      if (!app) {
        const api = url.pathname === '/plans' || url.pathname === '/demo/plans' || url.pathname.startsWith('/admin/')
          || (url.pathname.startsWith('/p/') && request.method !== 'GET' && request.method !== 'HEAD');
        return api
          ? new Response(`${JSON.stringify({ error: { code: 'planny_not_configured', message: 'planny is not configured yet. Try again later.' } })}\n`, {
            status: 503,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
          : new Response('<!doctype html><html><head><meta charset="utf-8"><title>Not configured | planny</title></head>'
            + '<body style="margin:0;background:#000;color:#f5f5f5;font:16px/1.6 ui-sans-serif,system-ui;padding:10vh 8vw">'
            + '<p style="font:600 12px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#4d9fff">Not configured</p>'
            + '<h1 style="font-size:2rem;letter-spacing:-.03em">planny is not configured yet.</h1>'
            + '<p style="color:#a1a1a1;max-width:38rem">The deployment is missing its storage settings. Reads and uploads start once they are set. Deletes and takedowns are not possible yet.</p>'
            + '</body></html>', {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          });
      }
      const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
      return app.fetch(request, { address: forwarded || 'unknown' });
    },
  };
}
