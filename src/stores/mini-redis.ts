import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { withLock } from './lock.js';

export type CommandResult = string | number | null | Record<string, string> | string[];
export type CommandFn = (name: string, args: readonly string[]) => CommandResult;

export interface MiniRedis {
  readonly file: string;
  transaction<T>(work: (run: CommandFn) => T): Promise<T>;
  command(name: string, args: readonly string[]): Promise<CommandResult>;
}

interface Data {
  strings: Record<string, string>;
  hashes: Record<string, Record<string, string>>;
  zsets: Record<string, Record<string, number>>;
  expires: Record<string, number>;
}

// A small in-memory subset of Redis, saved to one JSON file after each write. The file is
// replaced by rename, so a crash leaves the old state or the new one, never part of both.
export function createMiniRedis({ file, now = () => Date.now() }: { file: string; now?: () => number }): MiniRedis {
  let data: Data = emptyData();
  let signature: string | null = null;
  let dirty = false;
  const lockDir = `${file}.lock`;

  function emptyData(): Data {
    return { strings: {}, hashes: {}, zsets: {}, expires: {} };
  }

  function fileSignature(): string {
    const stat = statSync(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  }

  function refresh(): void {
    if (!existsSync(file)) {
      data = emptyData();
      signature = null;
      return;
    }
    const latest = fileSignature();
    if (latest !== signature) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      data = parsed as Data;
      signature = latest;
    }
  }

  function save(): void {
    if (!dirty) return;
    prune();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    const fd = openSync(temp, 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    signature = fileSignature();
    dirty = false;
  }

  function prune(): void {
    const at = now();
    for (const [key, expiresAt] of Object.entries(data.expires)) {
      if (expiresAt <= at) drop(key);
    }
  }

  function drop(key: string): void {
    delete data.strings[key];
    delete data.hashes[key];
    delete data.zsets[key];
    delete data.expires[key];
    dirty = true;
  }

  function exists(key: string): boolean {
    return Object.hasOwn(data.strings, key) || Object.hasOwn(data.hashes, key) || Object.hasOwn(data.zsets, key);
  }

  function expireIfDue(key: string): void {
    if (Object.hasOwn(data.expires, key) && (data.expires[key] ?? 0) <= now()) drop(key);
  }

  function toInt(value: string): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('value is not an integer');
    return number;
  }

  function bump(key: string, by: number): number {
    expireIfDue(key);
    const next = toInt(Object.hasOwn(data.strings, key) ? data.strings[key] ?? '0' : '0') + by;
    data.strings[key] = String(next);
    dirty = true;
    return next;
  }

  function hashFor(key: string): Record<string, string> {
    const existing = data.hashes[key];
    if (existing) return existing;
    const created: Record<string, string> = {};
    data.hashes[key] = created;
    return created;
  }

  function setFor(key: string): Record<string, number> {
    const existing = data.zsets[key];
    if (existing) return existing;
    const created: Record<string, number> = {};
    data.zsets[key] = created;
    return created;
  }

  function zrangeByScore([key = '', min = '-inf', max = '+inf', ...options]: readonly string[]): string[] {
    const set = data.zsets[key] ?? {};
    const low = min === '-inf' ? -Infinity : Number(min);
    const high = max === '+inf' ? Infinity : Number(max);
    let offset = 0;
    let count = Infinity;
    if ((options[0] ?? '').toUpperCase() === 'LIMIT') {
      offset = toInt(options[1] ?? '0');
      count = toInt(options[2] ?? '0');
    }
    return Object.entries(set)
      .filter(([, score]) => score >= low && score <= high)
      .sort(([a, scoreA], [b, scoreB]) => scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0))
      .slice(offset, count < 0 ? undefined : offset + count)
      .map(([member]) => member);
  }

  function executeCommand(name: string, args: readonly string[]): CommandResult {
    switch (name.toUpperCase()) {
      case 'GET': {
        const key = args[0] ?? '';
        expireIfDue(key);
        return Object.hasOwn(data.strings, key) ? data.strings[key] ?? null : null;
      }
      case 'SET': {
        const [key = '', value = '', ...flags] = args;
        expireIfDue(key);
        if (flags.map((flag) => flag.toUpperCase()).includes('NX') && Object.hasOwn(data.strings, key)) return null;
        data.strings[key] = value;
        dirty = true;
        return 'OK';
      }
      case 'INCR':
        return bump(args[0] ?? '', 1);
      case 'INCRBY':
        return bump(args[0] ?? '', toInt(args[1] ?? '0'));
      case 'DECRBY':
        return bump(args[0] ?? '', -toInt(args[1] ?? '0'));
      case 'HINCRBY': {
        const [key = '', field = '', by = '0'] = args;
        expireIfDue(key);
        const hash = hashFor(key);
        const next = toInt(hash[field] ?? '0') + toInt(by);
        hash[field] = String(next);
        dirty = true;
        return next;
      }
      case 'HSET': {
        const [key = '', ...pairs] = args;
        expireIfDue(key);
        const hash = hashFor(key);
        let added = 0;
        for (let index = 0; index < pairs.length; index += 2) {
          const field = pairs[index] ?? '';
          if (!Object.hasOwn(hash, field)) added += 1;
          hash[field] = pairs[index + 1] ?? '';
        }
        dirty = true;
        return added;
      }
      case 'HGET': {
        const [key = '', field = ''] = args;
        expireIfDue(key);
        const hash = data.hashes[key];
        return hash && Object.hasOwn(hash, field) ? hash[field] ?? null : null;
      }
      case 'HGETALL': {
        const key = args[0] ?? '';
        expireIfDue(key);
        return { ...(data.hashes[key] ?? {}) };
      }
      case 'ZADD': {
        const [key = '', ...pairs] = args;
        expireIfDue(key);
        const set = setFor(key);
        let added = 0;
        for (let index = 0; index < pairs.length; index += 2) {
          const member = pairs[index + 1] ?? '';
          if (!Object.hasOwn(set, member)) added += 1;
          set[member] = Number(pairs[index]);
        }
        dirty = true;
        return added;
      }
      case 'ZREM': {
        const [key = '', member = ''] = args;
        expireIfDue(key);
        const set = data.zsets[key];
        if (!set || !Object.hasOwn(set, member)) return 0;
        delete set[member];
        dirty = true;
        return 1;
      }
      case 'ZRANGEBYSCORE': {
        expireIfDue(args[0] ?? '');
        return zrangeByScore(args);
      }
      case 'EXPIRE': {
        const [key = '', seconds = '0'] = args;
        expireIfDue(key);
        if (!exists(key)) return 0;
        data.expires[key] = now() + toInt(seconds) * 1000;
        dirty = true;
        return 1;
      }
      case 'EXISTS': {
        let found = 0;
        for (const key of args) {
          expireIfDue(key);
          if (exists(key)) found += 1;
        }
        return found;
      }
      case 'DEL': {
        let removed = 0;
        for (const key of args) {
          expireIfDue(key);
          if (exists(key)) {
            drop(key);
            removed += 1;
          }
        }
        return removed;
      }
      default:
        throw new Error(`unsupported command: ${name}`);
    }
  }

  return {
    file,
    async transaction<T>(work: (run: CommandFn) => T): Promise<T> {
      let result: T | undefined;
      await withLock(lockDir, () => {
        refresh();
        try {
          result = work(executeCommand);
          save();
        } catch (error) {
          signature = null;
          dirty = false;
          throw error;
        }
      });
      return result as T;
    },
    command: (name, args) => (async () => {
      let value: CommandResult = null;
      await withLock(lockDir, () => {
        refresh();
        value = executeCommand(name, args);
        save();
      });
      return value;
    })(),
  };
}
