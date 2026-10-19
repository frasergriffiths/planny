#!/usr/bin/env node
// Operator commands. The local build is the default. With PLANNY_BUILD=vercel and the Vercel
// environment pulled (vercel env pull), the same commands run against the Vercel build.
//   node scripts/admin.mjs takedown <plan-id>   take a plan down now
//   node scripts/admin.mjs sweep                remove expired and abandoned plans
//   node scripts/admin.mjs uploads on|off|status   local build only
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadOrCreateSecret } from '../src/secret.js';
import { createLocalStore } from '../src/stores/local.js';
import { createVercelApp } from '../src/vercel.js';

const vercel = process.env.PLANNY_BUILD === 'vercel';
const dataDir = process.env.PLANNY_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'planny-local');
const port = Number(process.env.PLANNY_LOCAL_PORT || 4317);
const [command, argument] = process.argv.slice(2);
const usage = 'Usage: node scripts/admin.mjs takedown <plan-id> | sweep | uploads on|off|status';

try {
  if (command !== 'takedown' && command !== 'sweep' && command !== 'uploads') {
    console.error(usage);
    process.exitCode = 2;
  } else if (command === 'uploads' && vercel) {
    console.error('Change the upload switch with the Vercel CLI: vercel global-config update --patch.');
    process.exitCode = 2;
  } else if (command === 'uploads' && !['on', 'off', 'status'].includes(argument)) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const store = vercel ? null : createLocalStore({ dataDir });
    const app = vercel
      ? createVercelApp({ env: process.env, log: console })
      : createApp({
        build: 'local',
        store,
        config: loadConfig(),
        secret: loadOrCreateSecret(join(dataDir, 'address.key')),
        origin: `http://127.0.0.1:${port}`,
        log: console,
      });
    if (command === 'takedown') {
      console.log(JSON.stringify(await app.takedown(argument)));
    } else if (command === 'sweep') {
      console.log(JSON.stringify(await app.sweep({ limit: 50 })));
    } else if (argument === 'status') {
      console.log((await store.control.uploadsEnabled()) ? 'Uploads on.' : 'Uploads off.');
    } else {
      await store.control.setUploadsEnabled(argument === 'on');
      console.log(`Uploads ${argument}.`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
