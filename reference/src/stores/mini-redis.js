import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// A small in-memory subset of Redis, saved to one JSON file after each write. The file is
// replaced by rename, so a crash leaves the old state or the new one, never part of both.
// The server and admin commands are separate processes, so a lock directory serialises
// their read-modify-write steps across processes.
export function createMiniRedis({ file, now = () => Date.now(), lockStaleMs = 2000, lockWaitMs = 5000 }) {
  let data = emptyData();
  let signature = null;
  let dirty = false;
  const lockDir = `${file}.lock`;

  function emptyData() {
    return { strings: {}, hashes: {}, zsets: {}, expires: {} };
  }

  async function acquireLock() {
    const started = Date.now();
    for (;;) {
      try {
        mkdirSync(lockDir, { mode: 0o700 });
        writeFileSync(join(lockDir, 'owner'), `${process.pid}\n`, { mode: 0o600 });
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lockDir).mtimeMs > lockStaleMs) {
            rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - started > lockWaitMs) throw new Error('state file is busy');
        await sleep(5 + Math.floor(Math.random() * 10));
      }
    }
  }

  function releaseLock() {
    rmSync(lockDir, { recursive: true, force: true });
  }

  function fileSignature() {
    const stat = statSync(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  }

  function refresh() {
    if (!existsSync(file)) {
      data = emptyData();
      signature = null;
      return;
    }
    const latest = fileSignature();
    if (latest !== signature) {
      data = JSON.parse(readFileSync(file, 'utf8'));
      signature = latest;
    }
  }

  function save() {
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

  function prune() {
    const at = now();
    for (const [key, expiresAt] of Object.entries(data.expires)) {
      if (expiresAt <= at) drop(key);
    }
  }

  function drop(key) {
    delete data.strings[key];
    delete data.hashes[key];
    delete data.zsets[key];
    delete data.expires[key];
    dirty = true;
  }

  function exists(key) {
    return Object.hasOwn(data.strings, key) || Object.hasOwn(data.hashes, key) || Object.hasOwn(data.zsets, key);
  }

  function expireIfDue(key) {
    if (Object.hasOwn(data.expires, key) && data.expires[key] <= now()) drop(key);
  }

  function toInt(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error('value is not an integer');
    return number;
  }

  function bump(key, by) {
    expireIfDue(key);
    const next = toInt(Object.hasOwn(data.strings, key) ? data.strings[key] : 0) + by;
    data.strings[key] = String(next);
    dirty = true;
    return next;
  }

  function hashFor(key) {
    if (!Object.hasOwn(data.hashes, key)) data.hashes[key] = {};
    return data.hashes[key];
  }

  function setFor(key) {
    if (!Object.hasOwn(data.zsets, key)) data.zsets[key] = {};
    return data.zsets[key];
  }

  const commands = {
    GET: ([key]) => {
      expireIfDue(key);
      return Object.hasOwn(data.strings, key) ? data.strings[key] : null;
    },
    SET: ([key, value]) => {
      expireIfDue(key);
      data.strings[key] = String(value);
      dirty = true;
      return 'OK';
    },
    INCR: ([key]) => bump(key, 1),
    INCRBY: ([key, by]) => bump(key, toInt(by)),
    DECRBY: ([key, by]) => bump(key, -toInt(by)),
    EXISTS: (keys) => keys.filter((key) => {
      expireIfDue(key);
      return exists(key);
    }).length,
    DEL: (keys) => keys.filter((key) => {
      expireIfDue(key);
      const found = exists(key);
      if (found) drop(key);
      return found;
    }).length,
    EXPIRE: ([key, seconds]) => {
      expireIfDue(key);
      if (!exists(key)) return 0;
      data.expires[key] = now() + toInt(seconds) * 1000;
      dirty = true;
      return 1;
    },
    HSET: ([key, ...pairs]) => {
      expireIfDue(key);
      const hash = hashFor(key);
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!Object.hasOwn(hash, pairs[i])) added += 1;
        hash[pairs[i]] = String(pairs[i + 1]);
      }
      dirty = true;
      return added;
    },
    HGET: ([key, field]) => {
      expireIfDue(key);
      const hash = data.hashes[key];
      return hash && Object.hasOwn(hash, field) ? hash[field] : null;
    },
    HGETALL: ([key]) => {
      expireIfDue(key);
      return { ...(Object.hasOwn(data.hashes, key) ? data.hashes[key] : {}) };
    },
    ZADD: ([key, ...pairs]) => {
      expireIfDue(key);
      const set = setFor(key);
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!Object.hasOwn(set, pairs[i + 1])) added += 1;
        set[pairs[i + 1]] = Number(pairs[i]);
      }
      dirty = true;
      return added;
    },
    ZREM: ([key, member]) => {
      expireIfDue(key);
      const set = data.zsets[key];
      if (!set || !Object.hasOwn(set, member)) return 0;
      delete set[member];
      dirty = true;
      return 1;
    },
    ZRANGEBYSCORE: ([key, min, max, ...options]) => {
      expireIfDue(key);
      const set = Object.hasOwn(data.zsets, key) ? data.zsets[key] : {};
      const low = min === '-inf' ? -Infinity : Number(min);
      const high = max === '+inf' ? Infinity : Number(max);
      let offset = 0;
      let count = Infinity;
      if (String(options[0] ?? '').toUpperCase() === 'LIMIT') {
        offset = toInt(options[1]);
        count = toInt(options[2]);
      }
      return Object.entries(set)
        .filter(([, score]) => score >= low && score <= high)
        .sort(([a, scoreA], [b, scoreB]) => scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0))
        .slice(offset, count < 0 ? undefined : offset + count)
        .map(([member]) => member);
    },
  };

  function exec(name, args) {
    const upper = String(name).toUpperCase();
    if (!Object.hasOwn(commands, upper)) throw new Error(`unsupported command: ${name}`);
    return commands[upper](args.map(String));
  }

  async function transaction(work) {
    await acquireLock();
    try {
      refresh();
      try {
        const result = work(exec);
        save();
        return result;
      } catch (error) {
        signature = null;
        dirty = false;
        throw error;
      }
    } finally {
      releaseLock();
    }
  }

  return {
    file,
    transaction,
    command: (name, args) => transaction((run) => run(name, args)),
  };
}
