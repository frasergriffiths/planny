import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLuaRunner } from './lua-runner.js';
import { createMiniRedis } from './mini-redis.js';

const SAFE_ID = /^[0-9a-f-]{36}$/;

// The local build keeps records and counters in state.json (saved by rename after each write),
// plan HTML in plans/ and the upload switch in control.json. All of it sits outside the repo.
export function createLocalStore({ dataDir }) {
  const plansDir = join(dataDir, 'plans');
  mkdirSync(plansDir, { recursive: true, mode: 0o700 });
  const db = createMiniRedis({ file: join(dataDir, 'state.json') });
  const runner = createLuaRunner();
  const controlFile = join(dataDir, 'control.json');

  function blobFile(id) {
    if (!SAFE_ID.test(id)) throw new Error(`refusing unsafe plan id: ${id}`);
    return join(plansDir, `${id}.html`);
  }

  return {
    build: 'local',
    dataDir,
    redis: {
      async eval(source, keys, argv) {
        return db.transaction((run) => runner.run(source, keys, argv, run));
      },
      async hgetall(key) {
        return db.transaction((run) => run('HGETALL', [key]));
      },
      async zrangebyscore(key, max, limit) {
        return db.transaction((run) => run('ZRANGEBYSCORE', [key, '-inf', String(max), 'LIMIT', '0', String(limit)]));
      },
    },
    blobs: {
      async put(id, bytes) {
        const file = blobFile(id);
        const temp = `${file}.tmp`;
        writeFileSync(temp, bytes, { mode: 0o600 });
        renameSync(temp, file);
      },
      async get(id) {
        try {
          return new Uint8Array(readFileSync(blobFile(id)));
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      },
      async remove(id) {
        rmSync(blobFile(id), { force: true });
      },
    },
    control: {
      async uploadsEnabled() {
        try {
          return JSON.parse(readFileSync(controlFile, 'utf8')).uploadsEnabled === true;
        } catch (error) {
          if (error.code === 'ENOENT') return true;
          throw error;
        }
      },
      async setUploadsEnabled(enabled) {
        const temp = `${controlFile}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ uploadsEnabled: Boolean(enabled) })}\n`, { mode: 0o600 });
        renameSync(temp, controlFile);
      },
    },
    async purge() {},
  };
}
