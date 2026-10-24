#!/usr/bin/env node
// Operator commands for the TypeScript build. The local build is the default. With
// PLANNY_BUILD=vercel and the Vercel environment pulled, the same commands hit the Vercel store.
//   tsx scripts/admin.ts takedown <plan-id>
//   tsx scripts/admin.ts sweep
//   tsx scripts/admin.ts uploads on|off|status
//   tsx scripts/admin.ts reset reads|bytes|uploads|demo|all
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import type { Logger } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadOrCreateSecret } from '../src/secret.js';
import { createLocalStore } from '../src/stores/local.js';
import { createVercelApp } from '../src/vercel.js';

const vercel = process.env.PLANNY_BUILD === 'vercel';
const dataDir = process.env.PLANNY_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'planny-local');
const port = Number(process.env.PLANNY_LOCAL_PORT ?? 4317);
const [command, argument] = process.argv.slice(2);
const usage = 'Usage: tsx scripts/admin.ts takedown <plan-id> | sweep | uploads on|off|status | reset reads|bytes|uploads|demo|all';

const log: Logger = {
  error: (...args) => console.error(...args),
  alert: (message, fields) => console.error(`ALERT ${message} ${JSON.stringify(fields)}`),
};

async function main(): Promise<void> {
  if (command === 'uploads' && !['on', 'off', 'status'].includes(argument ?? '')) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  const app = vercel
    ? createVercelApp({ env: process.env, log })
    : createApp({
      build: 'local',
      store: createLocalStore({ dataDir }),
      config: loadConfig(),
      secret: loadOrCreateSecret(join(dataDir, 'address.key')),
      origin: `http://127.0.0.1:${port}`,
      log,
    });
  if (command === 'takedown') {
    console.log(JSON.stringify(await app.takedown(argument ?? '')));
  } else if (command === 'sweep') {
    console.log(JSON.stringify(await app.sweep({ limit: 50 })));
  } else if (command === 'uploads' && argument === 'status') {
    console.log((await app.uploadsEnabled()) ? 'Uploads on.' : 'Uploads off.');
  } else if (command === 'uploads') {
    await app.setUploadsEnabled(argument === 'on');
    console.log(`Uploads ${argument}.`);
  } else if (command === 'reset' && ['reads', 'bytes', 'uploads', 'demo', 'all'].includes(argument ?? '')) {
    console.log(JSON.stringify({ reset: argument, before: await app.resetMonth(argument as 'reads' | 'bytes' | 'uploads' | 'demo' | 'all') }));
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
