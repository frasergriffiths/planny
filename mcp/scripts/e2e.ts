#!/usr/bin/env bun
// End-to-end check for the built MCP server. It starts a local planny server on a
// throwaway SQLite store, drives mcp/dist/index.js over stdio with the MCP SDK client,
// and checks the full publish -> read -> delete -> 410 path plus the failure modes.
//
// Run from mcp/:  bun run build && bun run e2e
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const builtServer = resolve(here, '../dist/index.js');
const installedServer = process.env.PLANNY_MCP_BIN;
const serverCommand = installedServer ?? process.execPath;
const serverArgs = installedServer ? [] : [builtServer];
const port = Number(process.env.PLANNY_E2E_PORT ?? 4399);
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'planny-mcp-e2e-'));
const HTML = '<!doctype html><html><head><title>MCP e2e</title></head><body><h1>MCP e2e plan</h1></body></html>';

let local: ChildProcess | null = null;
let client: Client | null = null;
let localLog = '';
let mcpLog = '';
const checks: string[] = [];

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
};

function pass(name: string): void {
  checks.push(name);
  console.log(`ok - ${name}`);
}

function toolText(result: ToolResult): string {
  return (result.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

async function waitForLocal(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // The listener is not up yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`local planny did not start on ${base}\n${localLog}`);
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  assert.ok(client, 'MCP client is not connected');
  return await client.callTool({ name, arguments: args }) as ToolResult;
}

// Schema validation can arrive as a tool result or as a JSON-RPC error, depending on how
// the client sends the call. Both are a rejection for this check.
async function expectToolError(name: string, args: Record<string, unknown>, pattern: RegExp): Promise<string> {
  let message = '';
  try {
    const result = await call(name, args);
    assert.equal(result.isError, true, `${name} should have returned isError`);
    message = toolText(result);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, pattern, `${name} error should mention ${pattern}: ${message}`);
  return message;
}

async function main(): Promise<void> {
  local = spawn(process.execPath, ['run', 'dev'], {
    cwd: repo,
    env: {
      ...process.env,
      PLANNY_DATA_DIR: dataDir,
      PLANNY_LOCAL_PORT: String(port),
      PLANNY_UPLOAD_SPACING_SECONDS: '120',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  local.stdout?.on('data', (chunk: Buffer) => { localLog += chunk.toString(); });
  local.stderr?.on('data', (chunk: Buffer) => { localLog += chunk.toString(); });
  await waitForLocal();
  pass('local planny is listening');

  const transport = new StdioClientTransport({
    command: serverCommand,
    args: serverArgs,
    env: { ...process.env, PLANNY_URL: base },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    mcpLog += chunk.toString();
    process.stderr.write(chunk);
  });
  client = new Client({ name: 'planny-mcp-e2e', version: '0.0.0' });
  await client.connect(transport);
  await new Promise((done) => setTimeout(done, 100));
  assert.match(mcpLog, /planny-mcp ready: /, 'the server should print its startup line to stderr');
  pass('built MCP server starts and prints its startup line');

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ['delete_plan', 'publish_plan']);
  pass('tools/list exposes publish_plan and delete_plan only');

  // Exercise the API's own 4 MiB cap before the gate has been used.
  const oversizedBody = 'x'.repeat(4 * 1024 * 1024 + 1);
  const oversizedResponse = await fetch(`${base}/plans?name=Big&duration=1h`, {
    method: 'POST',
    headers: { 'content-type': 'text/html' },
    body: oversizedBody,
  });
  assert.equal(oversizedResponse.status, 413);
  const oversizedError = await oversizedResponse.json() as { error?: { code?: string } };
  assert.equal(oversizedError.error?.code, 'too_large');
  pass('API returns 413 too_large for an oversized body');

  const published = await call('publish_plan', { name: 'MCP e2e plan', html: HTML, duration: '1h' });
  assert.equal(published.isError, undefined);
  const publishedText = toolText(published);
  const url = /^Published: (.+)$/m.exec(publishedText)?.[1];
  const deleteKey = /^Delete key: (.+)$/m.exec(publishedText)?.[1];
  assert.ok(url, `publish_plan should return a link:\n${publishedText}`);
  assert.ok(deleteKey, `publish_plan should return a delete key:\n${publishedText}`);
  assert.match(url, /\/p\/[0-9a-f-]{36}$/);
  pass('publish_plan returns a link and delete key');

  const served = await fetch(url);
  assert.equal(served.status, 200);
  assert.match(await served.text(), /MCP e2e plan/);
  pass('the published link serves the plan (200)');

  const wrongKey = await expectToolError('delete_plan', { id: url, deleteKey: 'a'.repeat(64) }, /wrong_key, HTTP 403/);
  assert.match(wrongKey, /That delete key does not match this plan/);
  pass('delete_plan rejects a wrong key (403 wrong_key)');

  await expectToolError('delete_plan', { id: url, deleteKey: ' ' }, /missing_key, HTTP 401/);
  pass('delete_plan rejects a blank key (401 missing_key)');

  await expectToolError('delete_plan', { id: url, deleteKey: '' }, /deleteKey|Invalid arguments/i);
  pass('delete_plan rejects an empty key before calling the API');

  await expectToolError('publish_plan', { name: 'Too soon', html: HTML, duration: '1h' }, /address_upload_rate_limited, HTTP 429/);
  pass('a second publish inside the 120 s window returns 429');

  const deleted = await call('delete_plan', { id: url, deleteKey });
  assert.match(toolText(deleted), /^Deleted [0-9a-f-]{36}\. The link no longer works\.$/m);
  pass('delete_plan deletes with the returned key');

  const gone = await fetch(url);
  assert.equal(gone.status, 410);
  pass('the old link returns 410 after deletion');

  await expectToolError('publish_plan', { name: 'Bad duration', html: HTML, duration: 'soon' }, /duration|number and a unit/i);
  pass('publish_plan rejects a bad duration before calling the API');

  await expectToolError('publish_plan', { name: 'Too big', html: oversizedBody }, /4 MiB|4194304/);
  pass('publish_plan rejects an oversized plan before calling the API');

  console.log(`\n${checks.length} checks passed`);
}

async function cleanup(): Promise<void> {
  try {
    await client?.close();
  } catch {
    // The client may already be closed.
  }
  if (local && local.exitCode === null) {
    const exited = new Promise<void>((done) => local?.once('exit', () => done()));
    local.kill('SIGTERM');
    await Promise.race([exited, new Promise((done) => setTimeout(done, 2_000))]);
  }
  rmSync(dataDir, { recursive: true, force: true });
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    if (mcpLog) console.error(`--- mcp stderr ---\n${mcpLog}`);
    if (localLog) console.error(`--- local planny output ---\n${localLog}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
