import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLuaRunner } from './lua-runner.js';
import type { CommandFn } from './mini-redis.js';
import { createSqliteStore } from './sqlite.js';

export interface RedisLike {
  eval(script: string, keys: string[], argv: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  zrangebyscore(key: string, max: number, limit: number): Promise<string[]>;
}

export interface BlobStore {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  remove(id: string): Promise<void>;
}

export interface ControlStore {
  uploadsEnabled(): Promise<boolean>;
  setUploadsEnabled(enabled: boolean): Promise<void>;
}

export interface Store {
  readonly build: 'local' | 'vercel';
  readonly redis: RedisLike;
  readonly blobs: BlobStore;
  readonly control: ControlStore;
  purge(id: string): Promise<void>;
}

const SAFE_ID = /^[0-9a-f-]{36}$/;

// The local build keeps records, counters and rate windows in SQLite (state.db, WAL), plan HTML
// in plans/, and the upload switch in control.json. All of it sits outside the repo. An older
// state.json is migrated once on first open.
export function createLocalStore({ dataDir, now = () => Date.now() }: { dataDir: string; now?: () => number }): Store {
  const plansDir = join(dataDir, 'plans');
  mkdirSync(plansDir, { recursive: true, mode: 0o700 });
  const db = createSqliteStore({ file: join(dataDir, 'state.db'), legacyFile: join(dataDir, 'state.json'), now });
  const runner = createLuaRunner();
  const controlFile = join(dataDir, 'control.json');

  function blobFile(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`refusing unsafe plan id: ${id}`);
    return join(plansDir, `${id}.html`);
  }

  return {
    build: 'local',
    redis: {
      eval: (source, keys, argv) => db.transaction((run: CommandFn) => runner.run(source, keys, argv, run)),
      hgetall: (key) => db.transaction((run) => run('HGETALL', [key]) as unknown as Record<string, string>),
      zrangebyscore: (key, max, limit) =>
        db.transaction((run) => run('ZRANGEBYSCORE', [key, '-inf', String(max), 'LIMIT', '0', String(limit)]) as unknown as string[]),
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
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
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
          const raw: unknown = JSON.parse(readFileSync(controlFile, 'utf8'));
          return typeof raw === 'object' && raw !== null && (raw as { uploadsEnabled?: unknown }).uploadsEnabled === true;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true;
          throw error;
        }
      },
      async setUploadsEnabled(enabled) {
        const temp = `${controlFile}.tmp`;
        writeFileSync(temp, `${JSON.stringify({ uploadsEnabled: enabled })}\n`, { mode: 0o600 });
        renameSync(temp, controlFile);
      },
    },
    async purge() {},
  };
}
