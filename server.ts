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
  const app = createVercelApp({ env: process.env, waitUntil });
  return {
    port: Number(process.env.PORT ?? 3000),
    fetch: async (request: Request): Promise<Response> => {
      const forwarded = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
      return app.fetch(request, { address: forwarded || 'unknown' });
    },
  };
}
