import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import type { CommandFn, CommandResult } from './mini-redis.js';

interface LegacyData {
  strings?: Record<string, string>;
  hashes?: Record<string, Record<string, string>>;
  zsets?: Record<string, Record<string, number>>;
  expires?: Record<string, number>;
}

// SQLite-backed local store. Records, counters and rate windows are rows here, and every
// transaction runs inside BEGIN IMMEDIATE, so concurrent processes can't interleave a
// read-modify-write. Durable, atomic, and no lock files.
export function createSqliteStore({ file, legacyFile, now = () => Date.now() }: {
  file: string;
  legacyFile?: string;
  now?: () => number;
}) {
  const db = new Database(file, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS strings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hashes (k TEXT NOT NULL, f TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (k, f));
    CREATE TABLE IF NOT EXISTS zsets (k TEXT NOT NULL, m TEXT NOT NULL, s REAL NOT NULL, PRIMARY KEY (k, m));
    CREATE TABLE IF NOT EXISTS expires (k TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS zsets_score ON zsets (k, s);
    CREATE INDEX IF NOT EXISTS expires_at ON expires (at);
  `);

  const statements = {
    getString: db.query<{ v: string }, [string]>('SELECT v FROM strings WHERE k = ?'),
    putString: db.query('INSERT INTO strings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
    dropString: db.query('DELETE FROM strings WHERE k = ?'),
    getExpiry: db.query<{ at: number }, [string]>('SELECT at FROM expires WHERE k = ?'),
    putExpiry: db.query('INSERT INTO expires (k, at) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET at = excluded.at'),
    dropExpiry: db.query('DELETE FROM expires WHERE k = ?'),
    pruneExpiries: db.query<{ k: string }, [number]>('SELECT k FROM expires WHERE at <= ?'),
    existsHash: db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM hashes WHERE k = ?'),
    existsZset: db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM zsets WHERE k = ?'),
    hashAll: db.query<{ f: string; v: string }, [string]>('SELECT f, v FROM hashes WHERE k = ?'),
    hashGet: db.query<{ v: string }, [string, string]>('SELECT v FROM hashes WHERE k = ? AND f = ?'),
    hashPut: db.query('INSERT INTO hashes (k, f, v) VALUES (?, ?, ?) ON CONFLICT (k, f) DO UPDATE SET v = excluded.v'),
    hashDrop: db.query('DELETE FROM hashes WHERE k = ?'),
    zsetAdd: db.query('INSERT INTO zsets (k, m, s) VALUES (?, ?, ?) ON CONFLICT (k, m) DO UPDATE SET s = excluded.s'),
    zsetDrop: db.query('DELETE FROM zsets WHERE k = ?'),
    zsetRemove: db.query('DELETE FROM zsets WHERE k = ? AND m = ?'),
    zsetRange: db.query<{ m: string }, [string, number, number, number, number]>(
      'SELECT m FROM zsets WHERE k = ? AND s > ? AND s <= ? ORDER BY s ASC, m ASC LIMIT ? OFFSET ?',
    ),
    zsetCount: db.query<{ n: number }, [string, string, number, number]>('SELECT COUNT(*) AS n FROM zsets WHERE k = ? AND m = ? AND s > ? AND s <= ?'),
  };

  function prune(): void {
    const due = statements.pruneExpiries.all(now());
    for (const row of due) dropKey(row.k);
  }

  function expireIfDue(key: string): void {
    const row = statements.getExpiry.get(key);
    if (row && row.at <= now()) dropKey(key);
  }

  function dropKey(key: string): void {
    statements.dropString.run(key);
    statements.hashDrop.run(key);
    statements.zsetDrop.run(key);
    statements.dropExpiry.run(key);
  }

  function exists(key: string): boolean {
    return Boolean(statements.getString.get(key))
      || (statements.existsHash.get(key)?.n ?? 0) > 0
      || (statements.existsZset.get(key)?.n ?? 0) > 0;
  }

  function toInt(value: string): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('value is not an integer');
    return number;
  }

  function bump(key: string, by: number): number {
    expireIfDue(key);
    const current = statements.getString.get(key);
    const next = toInt(current?.v ?? '0') + by;
    statements.putString.run(key, String(next));
    return next;
  }

  function command(name: string, args: readonly string[]): CommandResult {
    switch (name.toUpperCase()) {
      case 'GET': {
        const key = args[0] ?? '';
        expireIfDue(key);
        return statements.getString.get(key)?.v ?? null;
      }
      case 'SET': {
        const [key = '', value = '', ...flags] = args;
        expireIfDue(key);
        if (flags.some((flag) => flag.toUpperCase() === 'NX') && statements.getString.get(key)) return null;
        statements.putString.run(key, value);
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
        const next = toInt(statements.hashGet.get(key, field)?.v ?? '0') + toInt(by);
        statements.hashPut.run(key, field, String(next));
        return next;
      }
      case 'HSET': {
        const [key = '', ...pairs] = args;
        expireIfDue(key);
        let added = 0;
        for (let index = 0; index < pairs.length; index += 2) {
          const field = pairs[index] ?? '';
          if (!statements.hashGet.get(key, field)) added += 1;
          statements.hashPut.run(key, field, pairs[index + 1] ?? '');
        }
        return added;
      }
      case 'HGET': {
        const [key = '', field = ''] = args;
        expireIfDue(key);
        return statements.hashGet.get(key, field)?.v ?? null;
      }
      case 'HGETALL': {
        const key = args[0] ?? '';
        expireIfDue(key);
        return Object.fromEntries(statements.hashAll.all(key).map((row) => [row.f, row.v]));
      }
      case 'ZADD': {
        const [key = '', ...pairs] = args;
        expireIfDue(key);
        let added = 0;
        for (let index = 0; index < pairs.length; index += 2) {
          const member = pairs[index + 1] ?? '';
          if ((statements.zsetCount.get(key, member, -Infinity, Infinity)?.n ?? 0) === 0) added += 1;
          statements.zsetAdd.run(key, member, Number(pairs[index]));
        }
        return added;
      }
      case 'ZREM': {
        const [key = '', member = ''] = args;
        expireIfDue(key);
        const found = (statements.zsetCount.get(key, member, -Infinity, Infinity)?.n ?? 0) > 0;
        if (found) statements.zsetRemove.run(key, member);
        return found ? 1 : 0;
      }
      case 'ZRANGEBYSCORE': {
        const [key = '', min = '-inf', max = '+inf', ...options] = args;
        expireIfDue(key);
        const low = min === '-inf' ? -Infinity : Number(min);
        const high = max === '+inf' ? Infinity : Number(max);
        let offset = 0;
        let count = 1000;
        if ((options[0] ?? '').toUpperCase() === 'LIMIT') {
          offset = toInt(options[1] ?? '0');
          count = toInt(options[2] ?? '1000');
        }
        const rows = statements.zsetRange.all(key, low, high, count < 0 ? 1_000_000 : count, offset);
        return rows.map((row) => row.m);
      }
      case 'EXPIRE': {
        const [key = '', seconds = '0'] = args;
        expireIfDue(key);
        if (!exists(key)) return 0;
        statements.putExpiry.run(key, now() + toInt(seconds) * 1000);
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
            dropKey(key);
            removed += 1;
          }
        }
        return removed;
      }
      default:
        throw new Error(`unsupported command: ${name}`);
    }
  }

  async function transaction<T>(work: (run: CommandFn) => T): Promise<T> {
    db.exec('BEGIN IMMEDIATE');
    try {
      prune();
      const result = work(command);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function migrateLegacy(): void {
    if (!legacyFile || !existsSync(legacyFile)) return;
    let legacy: LegacyData;
    try {
      legacy = JSON.parse(readFileSync(legacyFile, 'utf8')) as LegacyData;
    } catch {
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of Object.entries(legacy.strings ?? {})) statements.putString.run(key, value);
      for (const [key, fields] of Object.entries(legacy.hashes ?? {})) {
        for (const [field, value] of Object.entries(fields)) statements.hashPut.run(key, field, value);
      }
      for (const [key, members] of Object.entries(legacy.zsets ?? {})) {
        for (const [member, score] of Object.entries(members)) statements.zsetAdd.run(key, member, score);
      }
      for (const [key, at] of Object.entries(legacy.expires ?? {})) statements.putExpiry.run(key, at);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    renameSync(legacyFile, `${legacyFile}.migrated`);
  }

  migrateLegacy();

  return {
    file,
    transaction,
    command: (name: string, args: readonly string[]) => transaction((run) => run(name, args)),
    close: () => db.close(),
  };
}
