#!/usr/bin/env bun
// Publish one plan. The only publish path: it checks the file, posts it, and stores the delete
// key in a 0600 file under ~/.planny. It never prints the key.
//   bun publish.ts plan.html --name "Q4 rollout" [--duration 90d] [--base http://127.0.0.1:4317]
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const MAX_BYTES = 4_194_304;
const args = process.argv.slice(2);
const file = args[0];
if (!file) fail('Usage: bun publish.ts <plan.html> --name "..." [--duration 90d] [--base URL]');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const name = option('name');
if (!name) fail('Missing --name. Plans need a name of 1 to 120 characters.');
if ([...name].length > 120) fail('The name is over 120 characters.');
const duration = option('duration') ?? '30d';
if (!/^\d{1,6}[hdwmy]$/i.test(duration)) fail('Duration must look like 12h, 30d, 2w, 3m or 5y.');
const base = (option('base') ?? process.env.PLANNY_BASE ?? 'http://127.0.0.1:4317').replace(/\/$/, '');

let bytes: Buffer;
try {
  bytes = readFileSync(resolve(file));
} catch {
  fail(`Cannot read ${file}.`);
}
if (bytes.byteLength > MAX_BYTES) fail(`The plan is ${bytes.byteLength} bytes; the cap is ${MAX_BYTES}.`);
let html: string;
try {
  html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
  fail('The file is not valid UTF-8.');
}

const stripped: Array<[RegExp, string]> = [
  [/<script\b/i, 'script tags'],
  [/<a\s[^>]*href|<area\s[^>]*href/i, 'links (their text stays)'],
  [/<form\b|<input\b|<button\b/i, 'forms and controls'],
  [/<iframe\b|<object\b|<embed\b|<frame\b/i, 'frames and embeds'],
  [/<link\b|<base\b/i, 'link and base tags'],
  [/\son[a-z]+\s*=/i, 'event handlers'],
  [/https?:\/\//i, 'external URLs, which will be removed'],
];
for (const [pattern, label] of stripped) {
  if (pattern.test(html)) console.error(`warning: the plan contains ${label}; the sanitiser will remove them.`);
}

const url = `${base}/plans?${new URLSearchParams({ name, duration })}`;
const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/html' }, body: bytes });
const text = await response.text();
let body: Record<string, unknown>;
try {
  body = JSON.parse(text) as Record<string, unknown>;
} catch {
  fail(`Upload failed: ${response.status} ${text.slice(0, 200)}`);
}
if (response.status !== 201) {
  const error = body.error as { code?: string; message?: string } | undefined;
  fail(`Upload failed: ${response.status} ${error?.code ?? ''} ${error?.message ?? ''}`.trim());
}

const id = String(body.id);
const keyDir = join(homedir(), '.planny');
mkdirSync(keyDir, { recursive: true, mode: 0o700 });
const keyFile = join(keyDir, `${id}.json`);
try {
  writeFileSync(keyFile, `${JSON.stringify({
    id,
    url: body.url,
    expiresAt: body.expiresAt,
    deleteKey: body.deleteKey,
    name,
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
} catch (error) {
  fail(`The plan was published but its key file could not be created: ${error instanceof Error ? error.message : error}`);
}

const removed = (body.removed ?? {}) as Record<string, number>;
console.log(`Published ${basename(file)} (${bytes.byteLength} bytes).`);
console.log(`Link:    ${String(body.url)}`);
console.log(`Expires: ${String(body.expiresAt)}`);
console.log(`Key:     ${keyFile} (mode 0600; the key is not printed)`);
if (Object.keys(removed).length > 0) console.log(`Removed: ${JSON.stringify(removed)}`);
