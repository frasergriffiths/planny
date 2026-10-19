import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export interface LockOptions {
  readonly staleMs?: number;
  readonly waitMs?: number;
}

// A lock directory is atomic across processes, so the server and the admin script can share a
// state file without losing each other's writes. A lock older than staleMs belonged to a dead
// process and is removed. Waiting is async, so the event loop keeps serving requests.
export async function withLock(lockDir: string, work: () => void, options: LockOptions = {}): Promise<void> {
  const staleMs = options.staleMs ?? 2000;
  const waitMs = options.waitMs ?? 5000;
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      writeFileSync(`${lockDir}/owner`, `${process.pid}\n`, { mode: 0o600 });
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > staleMs) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > waitMs) throw new Error('state file is busy');
      await sleep(5 + Math.floor(Math.random() * 10));
    }
  }
  try {
    work();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
