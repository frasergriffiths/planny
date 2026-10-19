#!/usr/bin/env bun
// Delete one plan. The only delete path: the key stays in its 0600 file and is never printed.
//   bun delete.ts <plan-id-or-url> [--base https://planny-pink.vercel.app]
import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const target = args[0];
if (!target) fail('Usage: bun delete.ts <plan-id-or-url> [--base URL]');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const id = target.includes('/') ? (target.match(/\/p\/([0-9a-f-]{36})/)?.[1] ?? '') : target;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
  fail('Pass the plan id or its full link.');
}
const keyFile = join(homedir(), '.planny', `${id}.json`);
let record: { deleteKey?: string; url?: string };
try {
  record = JSON.parse(readFileSync(keyFile, 'utf8')) as { deleteKey?: string; url?: string };
} catch {
  fail(`No key file at ${keyFile}. It may already have been deleted.`);
}
if (!record.deleteKey) fail(`The key file ${keyFile} has no delete key.`);
let storedOrigin: string | undefined;
try {
  storedOrigin = record.url ? new URL(record.url).origin : undefined;
} catch {
  storedOrigin = undefined;
}
const chosen = option('base') ?? process.env.PLANNY_BASE;
if (!chosen && storedOrigin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(storedOrigin)) {
  fail('That key belongs to the retired local build. Local links no longer work; publish the plan to https://planny-pink.vercel.app.');
}
const base = (chosen ?? storedOrigin ?? 'https://planny-pink.vercel.app').replace(/\/$/, '');
const response = await fetch(`${base}/p/${id}`, {
  method: 'DELETE',
  headers: { authorization: `Bearer ${record.deleteKey}` },
});
console.log(`Delete ${id}: ${response.status}`);
if (response.status === 200 || response.status === 410) {
  rmSync(keyFile, { force: true });
  console.log('Key file removed.');
} else {
  const text = await response.text().catch(() => '');
  console.error(text.slice(0, 200));
  process.exit(1);
}
