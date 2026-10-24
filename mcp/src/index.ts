#!/usr/bin/env node
// A thin MCP wrapper over planny's existing HTTP API. There is deliberately no plan storage
// or sanitiser here: the server owns both, so this process only turns tool calls into the
// same requests an agent would make with curl.
//
// The API has no read or list endpoint (checked against src/app.ts: GET /p/:id returns the
// sanitised HTML, and there is no collection route), so this server does not invent one.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DEFAULT_BASE = 'https://use-planny.vercel.app';
const MAX_BYTES = 4 * 1024 * 1024;
const BASE = (process.env.PLANNY_URL ?? DEFAULT_BASE).replace(/\/+$/, '');

const durationSchema = z
  .string()
  .regex(/^\d{1,6}[hdwy]$/, 'Use a number and a unit: 12h, 30d, 2w or 5y.')
  .describe('How long the link lives: 12h, 30d, 2w or 5y. Defaults to 30d.');

const idSchema = z
  .string()
  .min(1)
  .describe('The plan id, or the full plan URL that publish_plan returned.');

interface ApiFailure {
  error?: { code?: string; message?: string };
}

function failure(status: number, body: unknown): string {
  const parsed = body as ApiFailure | null;
  const message = parsed?.error?.message;
  return message ? `${message} (HTTP ${status})` : `planny returned HTTP ${status}.`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text.slice(0, 400) } };
  }
}

function planIdFrom(value: string): string {
  const trimmed = value.trim();
  const match = /\/p\/([0-9a-fA-F-]{36})(?:[/?#]|$)/.exec(trimmed);
  return (match?.[1] ?? trimmed).toLowerCase();
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({ name: 'planny', version: '0.1.0' });

server.registerTool(
  'publish_plan',
  {
    title: 'Publish an HTML plan',
    description: [
      'Publish one self-contained HTML page to planny and get back a public link and a delete key.',
      'The server strips scripts, links, forms, frames, external files and fonts; CSS, inline SVG, tables',
      'and data: images survive. The delete key is shown once and is the only way to delete the plan early.',
      'The link is public: anyone who has it can read the plan, so do not publish secrets.',
    ].join(' '),
    inputSchema: {
      name: z.string().min(1).max(120).describe('A short plan name, 1 to 120 characters.'),
      html: z.string().min(1).describe('The whole HTML document as UTF-8 text. Maximum 4 MiB.'),
      duration: durationSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ name, html, duration }) => {
    const bytes = Buffer.byteLength(html, 'utf8');
    if (bytes > MAX_BYTES) {
      return errorResult(`That plan is ${bytes} bytes. planny caps a plan at 4 MiB (4194304 bytes).`);
    }
    const query = new URLSearchParams({ name });
    if (duration) query.set('duration', duration);
    let response: Response;
    try {
      response = await fetch(`${BASE}/plans?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html,
      });
    } catch (error) {
      return errorResult(`Could not reach planny at ${BASE}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = await readBody(response);
    if (!response.ok) return errorResult(failure(response.status, body));

    const published = body as {
      url?: string;
      id?: string;
      expiresAt?: string;
      bytes?: number;
      deleteKey?: string;
      removed?: Record<string, number>;
    };
    if (!published.url || !published.deleteKey || !published.expiresAt) {
      return errorResult('planny returned an unexpected response: no link or delete key.');
    }
    const removed = published.removed ?? {};
    const removedLine = Object.entries(removed)
      .filter(([, count]) => count > 0)
      .map(([what, count]) => `${what}: ${count}`)
      .join(', ');
    return textResult([
      `Published: ${published.url}`,
      `Expires: ${published.expiresAt}`,
      `Delete key: ${published.deleteKey}`,
      '',
      'Give the link to whoever should read the plan. Store the delete key now: planny will not show it again,',
      'and without it the plan can only be removed by its expiry date or by the site operator.',
      removedLine ? `Removed by the sanitiser: ${removedLine}.` : 'The sanitiser removed nothing.',
    ].join('\n'));
  },
);

server.registerTool(
  'delete_plan',
  {
    title: 'Delete a plan',
    description: 'Delete a published plan early. Needs the delete key that publish_plan returned for that plan.',
    inputSchema: {
      id: idSchema,
      deleteKey: z.string().min(1).describe('The delete key returned when the plan was published.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ id, deleteKey }) => {
    const planId = planIdFrom(id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(planId)) {
      return errorResult(`"${id}" is not a planny plan id. Pass the id or the full /p/ link.`);
    }
    let response: Response;
    try {
      response = await fetch(`${BASE}/p/${planId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${deleteKey}` },
      });
    } catch (error) {
      return errorResult(`Could not reach planny at ${BASE}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 200) return textResult(`Deleted ${planId}. The link no longer works.`);
    if (response.status === 410) return textResult(`${planId} was already removed. Nothing to do.`);
    const body = await readBody(response);
    return errorResult(failure(response.status, body));
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout belongs to the protocol; diagnostics go to stderr only.
  console.error(`planny-mcp ready: ${BASE}`);
}

main().catch((error: unknown) => {
  console.error('planny-mcp failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
