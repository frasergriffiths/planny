# planny MCP server

An MCP server for [planny](https://use-planny.vercel.app). It lets an agent publish one
self-contained HTML page and get back a public link plus a delete key.

> **0.1.0 is the published version.** The package is `planny-mcp@0.1.0`. Run it with
> `npx -y planny-mcp`. If npm does not serve 0.1.0 yet, use the clone/build fallback
> below. A self-hosted instance uses `PLANNY_URL`; the default is the hosted service.

## Tools

| Tool | What it does | Inputs | Output |
|---|---|---|---|
| `publish_plan` | Sanitises and publishes one HTML page | `name` (1-120 chars), `html` (whole document, max 4 MiB), optional `duration` (default `30d`) | Link, expiry, delete key, sanitiser summary |
| `delete_plan` | Deletes a plan before its expiry | `id` (UUID or full `/p/` link) and `deleteKey` | Deleted, or already removed |

There is **no read or list tool**. The HTTP API has no collection endpoint and no JSON
metadata route: `GET /p/<id>` returns the sanitised HTML itself. Adding a read tool would
mean inventing API surface that does not exist. If planny grows a metadata route later, a
third tool can wrap it.

## Prerequisites

- **Node.js 22 or newer with npm/npx** for the published package. `npx` ships with npm.
- **Bun 1.4 or newer only for the clone/build fallback.** The repository pins Bun 1.4.0 in
  `packageManager`. `bun install` from `mcp/` installs the workspace, including the
  TypeScript compiler used by `bun run build`.
- **No API key.** planny has no accounts. The delete key is the only credential, and it is
  returned once when a plan is published.
- `PLANNY_URL` only when you publish to a self-hosted planny. The default is
  `https://use-planny.vercel.app`.

## Install with npx

This is the normal path. It needs Node 22+ and does not clone the repository:

```sh
npx -y planny-mcp
```

The process is a stdio server, so it waits for MCP messages on stdin. It prints one line to
stderr:

```text
planny-mcp ready: https://use-planny.vercel.app
```

Stop it with Ctrl+C. stdout is reserved for the MCP protocol; logs and the startup line go
to stderr. If you see no startup line, the process failed before the handshake; see
[Troubleshooting](#troubleshooting).

Pin the release explicitly when a client or a lockfile needs it:

```sh
npx -y planny-mcp@0.1.0
```

To point at a self-hosted instance, set `PLANNY_URL` to its origin, with no trailing slash
and no path:

```sh
PLANNY_URL=https://plans.example.com npx -y planny-mcp
```

## Build from a clone

Use this fallback if npm does not serve 0.1.0 yet, or if you are changing the server. Run it
from the repository root:

```sh
git clone https://github.com/frasergriffiths/planny.git
cd planny/mcp
bun install
bun run build
```

`bun run build` writes `mcp/dist/index.js`. Use the **absolute** path to that file in the
client config. A client launched from the GUI does not share your shell's working directory,
so a relative path such as `mcp/dist/index.js` will not resolve.

```sh
PLANNY_URL=https://use-planny.vercel.app node /absolute/path/to/planny/mcp/dist/index.js
```

With Bun instead of Node:

```sh
PLANNY_URL=https://use-planny.vercel.app bun /absolute/path/to/planny/mcp/dist/index.js
```

## Client setup

All examples use the published package through `npx -y planny-mcp`. If you built from a
clone, replace the command and arguments with the fallback at the end of this section.
Replace `PLANNY_URL` only if you self-host; the value is an origin, not an upload URL.

### Claude Code

Add the server from a terminal:

```sh
claude mcp add --transport stdio planny -- npx -y planny-mcp
```

For all projects rather than the current one, add `--scope user`:

```sh
claude mcp add --scope user --transport stdio planny -- npx -y planny-mcp
```

For a self-hosted instance, pass the environment variable before the `--`:

```sh
claude mcp add --env PLANNY_URL=https://plans.example.com --transport stdio planny -- npx -y planny-mcp
```

Check the connection with `claude mcp list` or `/mcp` inside Claude Code. The status should
be `Connected`.

Claude Code also reads project-scoped JSON from `.mcp.json` at the repository root. The
`mcpServers` wrapper is part of that file format:

```json
{
  "mcpServers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "planny-mcp"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

The same entry can be added without editing the file:

```sh
claude mcp add-json planny '{"type":"stdio","command":"npx","args":["-y","planny-mcp"],"env":{"PLANNY_URL":"https://use-planny.vercel.app"}}'
```

A project-scoped `.mcp.json` server needs approval the first time Claude Code opens the
project.

### Claude Desktop

Open **Settings → Developer → Edit Config** and edit the file at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Use a top-level `mcpServers` object:

```json
{
  "mcpServers": {
    "planny": {
      "command": "npx",
      "args": ["-y", "planny-mcp"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

Save the file, quit Claude Desktop completely, and reopen it. The server's stderr log is at
`~/Library/Logs/Claude/mcp-server-planny.log` on macOS and
`%APPDATA%\Claude\logs\mcp-server-planny.log` on Windows.

### Cursor

Use `~/.cursor/mcp.json` for all projects or `.cursor/mcp.json` in a project. Cursor uses
`mcpServers` and requires `type: "stdio"` for a local command:

```json
{
  "mcpServers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "planny-mcp"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

Reload the window after saving. Cursor shows the server under **Customize → MCP**; the
**Output → MCP Logs** panel has connection errors.

### VS Code (Copilot agent mode)

Create `.vscode/mcp.json` in the workspace. The VS Code format uses a top-level `servers`
object, not `mcpServers`:

```json
{
  "servers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "planny-mcp"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

Open the file from **MCP: Open Workspace Folder MCP Configuration**, start the server from
**MCP: List Servers**, and approve the trust prompt. Then use Copilot agent mode and ask it
to publish a plan. The server output is under **MCP: List Servers → Show Output**.

VS Code also reads a portable `.mcp.json` with `mcpServers`, but that is a different file
format. Do not paste the portable block into `.vscode/mcp.json`; the `servers` wrapper is
required there.

### Codex CLI

Edit `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project. Codex uses a
`mcp_servers` table per server and a nested `env` table:

```toml
[mcp_servers.planny]
command = "npx"
args = ["-y", "planny-mcp"]

[mcp_servers.planny.env]
PLANNY_URL = "https://use-planny.vercel.app"
```

Restart Codex after saving. The `command` and `args` fields are the same stdio contract as
the JSON clients above.

### Generic stdio JSON

Most MCP clients accept this shape under `mcpServers`:

```json
{
  "mcpServers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "planny-mcp"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

Some clients call the top-level object `servers`, some require `type`, and some use
`command` plus `args` without a wrapper. Check the client's MCP reference before copying
the block. The published package always uses `npx` with `-y planny-mcp`.

### Clone fallback config

If you built from a clone, replace the command and arguments in any config above with the
absolute path to the built file:

```json
{
  "mcpServers": {
    "planny": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/planny/mcp/dist/index.js"],
      "env": {
        "PLANNY_URL": "https://use-planny.vercel.app"
      }
    }
  }
}
```

Use `"command": "bun"` with the same absolute argument if you run the built file with Bun.
VS Code's `.vscode/mcp.json` still uses `servers` rather than `mcpServers`; Codex still uses
the `mcp_servers` TOML table.

## What the tools return

### `publish_plan`

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 1 to 120 characters |
| `html` | string | yes | The whole HTML document, UTF-8, at most 4,194,304 bytes (4 MiB) |
| `duration` | string | no | Number plus `h`, `d`, `w` or `y`; `1h` to `100y`; default `30d` |

The text result has this shape:

```text
Published: https://use-planny.vercel.app/p/<uuid>
Expires: 2026-11-23T12:00:00.000Z
Delete key: <shown once>

Give the link to whoever should read the plan. Store the delete key now: planny will not show it again,
and without it the plan can only be removed by its expiry date or by the site operator.
Removed by the sanitiser: <what was stripped>, or "The sanitiser removed nothing."
```

The link is public to anyone who has it. Plans are not listed, but a shared link can be
indexed, so do not publish secrets, credentials or personal data. Scripts, links, forms,
frames and external resources are stripped by the server-side sanitiser before storage.

### `delete_plan`

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | A plan UUID or the full `/p/<uuid>` link |
| `deleteKey` | string | yes | The key returned by `publish_plan` for that plan |

Returns `Deleted <id>. The link no longer works.` on success, or
`<id> was already removed. Nothing to do.` when the plan is already gone.

### Limits and errors

The server owns these limits; the MCP wrapper does not enforce the rate limits itself. The
defaults below are the hosted service and the values in `.env.example`. A self-hosted
instance can differ.

| Limit | Default |
|---|---|
| Plan body | 4 MiB (4,194,304 bytes), before sanitising |
| Plan lifetime | 1 hour to 100 years; default 30 days |
| Upload spacing per address | 120 seconds |
| Uploads per address per day | 50 |
| Uploads per address per month | 500 |
| Plan storage per address | 1 GiB |
| Site uploads per month | 5,000 |

The MCP layer rejects an oversized plan, a bad duration, an empty name or an empty delete
key before making an HTTP request. Those errors have no HTTP status because no request was
sent. Errors returned by the API carry the API code and HTTP status in the text:

```text
This address has uploaded its 50 plans for today. Uploads resume at midnight UTC. (address_upload_daily_limit, HTTP 429)
```

| Code | HTTP | Tool | Meaning |
|---|---|---|---|
| `invalid_duration` | 400 | `publish_plan` | The duration is not a number plus `h`, `d`, `w` or `y` |
| `duration_too_short` | 400 | `publish_plan` | Less than 1 hour |
| `duration_too_long` | 400 | `publish_plan` | More than 100 years |
| `name_required` | 400 | `publish_plan` | Empty name |
| `name_too_long` | 400 | `publish_plan` | More than 120 characters |
| `invalid_query` | 400 | `publish_plan` | An unsupported query parameter |
| `unsupported_type` | 415 | `publish_plan` | The body is not `text/html` in UTF-8 |
| `empty_body` | 400 | `publish_plan` | The request body is empty |
| `too_large` | 413 | `publish_plan` | The body is over 4 MiB; the MCP layer normally catches this first |
| `invalid_encoding` | 400 | `publish_plan` | The body is not valid UTF-8 |
| `too_deep` | 400 | `publish_plan` | HTML nesting is deeper than the parser allows |
| `too_many_attributes` | 400 | `publish_plan` | HTML has more attributes than the parser allows |
| `uploads_paused` | 503 | `publish_plan` | The operator paused uploads |
| `address_upload_rate_limited` | 429 | `publish_plan` | A second upload arrived inside the 120-second spacing window |
| `address_upload_daily_limit` | 429 | `publish_plan` | 50 uploads from one address today |
| `address_upload_monthly_limit` | 429 | `publish_plan` | 500 uploads from one address this month |
| `storage_limit` | 429 | `publish_plan` | The address already stores its 1 GiB share |
| `storage_full` | 503 | `publish_plan` | The site has no room for new plans |
| `site_upload_monthly_limit` | 503 | `publish_plan` | The site has used its 5,000 uploads this month |
| `upload_failed` | 500 | `publish_plan` | Storage did not accept the plan; retry |
| `upload_interrupted` | 500 | `publish_plan` | The upload was cancelled before it went live; retry |
| `missing_key` | 401 | `delete_plan` | No usable bearer key |
| `wrong_key` | 403 | `delete_plan` | The key does not match that plan |
| `no_plan` | 404 | `delete_plan` | No plan with that id, or it is still pending |
| `already_removed` | 410 | `delete_plan` | The plan was already deleted, expired or taken down |
| `busy` | 409 | `delete_plan` | Another delete is in progress; check again |
| `rate_limited` | 429 | `delete_plan` | Too many delete attempts from one address |

A `429` response includes a `retry-after` header on the HTTP API. The MCP text includes the
server's message, so wait the stated time rather than retrying in a loop. A `503` is not a
reason to retry immediately either.

## Worked example

The following values are example data, not a live plan.

Publish:

```json
{
  "name": "Q4 rollout",
  "html": "<!doctype html><html><head><title>Q4 rollout</title></head><body><h1>Q4 rollout</h1><p>One page, one link.</p></body></html>",
  "duration": "30d"
}
```

Result:

```text
Published: https://use-planny.vercel.app/p/00000000-0000-4000-8000-000000000000
Expires: 2026-11-23T12:00:00.000Z
Delete key: EXAMPLE-KEY-NOT-A-REAL-KEY

Give the link to whoever should read the plan. Store the delete key now: planny will not show it again,
and without it the plan can only be removed by its expiry date or by the site operator.
The sanitiser removed nothing.
```

`curl -i https://use-planny.vercel.app/p/00000000-0000-4000-8000-000000000000` returns
`HTTP/2 200` and the sanitised page.

Delete:

```json
{
  "id": "https://use-planny.vercel.app/p/00000000-0000-4000-8000-000000000000",
  "deleteKey": "EXAMPLE-KEY-NOT-A-REAL-KEY"
}
```

Result:

```text
Deleted 00000000-0000-4000-8000-000000000000. The link no longer works.
```

The same `curl` now returns `HTTP/2 410 Gone`.

## Verify the install

The repository includes a real stdio check, not only a typecheck. From `mcp/`:

```sh
bun run verify
```

That runs `bun run build` and then `bun run e2e`. The script:

1. starts a local planny server on `127.0.0.1:4399` with a temporary SQLite store;
2. launches the built `mcp/dist/index.js` through the MCP SDK client over stdio;
3. checks `tools/list`, publishes a plan, fetches the link, rejects a wrong key, rejects a
   blank key, checks the 120-second `429`, deletes the plan, and confirms the old link is
   `410`;
4. checks the API's `413 too_large` response and the MCP pre-checks for a bad duration and
   an oversized plan.

It writes only to a temporary local store and never to the hosted service. Set
`PLANNY_E2E_PORT` if port 4399 is busy. A successful run looks like this:

```text
ok - local planny is listening
ok - built MCP server starts and prints its startup line
ok - tools/list exposes publish_plan and delete_plan only
ok - API returns 413 too_large for an oversized body
ok - publish_plan returns a link and delete key
ok - the published link serves the plan (200)
ok - delete_plan rejects a wrong key (403 wrong_key)
ok - delete_plan rejects a blank key (401 missing_key)
ok - delete_plan rejects an empty key before calling the API
ok - a second publish inside the 120 s window returns 429
ok - delete_plan deletes with the returned key
ok - the old link returns 410 after deletion
ok - publish_plan rejects a bad duration before calling the API
ok - publish_plan rejects an oversized plan before calling the API

14 checks passed
```

## Troubleshooting

### `npx: command not found` or `spawn npx ENOENT`

Install Node.js 22 or newer; `npx` ships with npm. GUI clients often do not inherit your
shell's `PATH`, so check where npx and node live:

```sh
which npx
which node
which bun
```

For a GUI client, use the absolute path in `command`, for example
`"command": "/opt/homebrew/bin/npx"` and the same `args`. If you cannot use npx, build from
a clone and point the config at the absolute `dist/index.js` path with Node or Bun.

### `npx` returns 404 or an old version

If npm does not serve `planny-mcp@0.1.0` yet, use the clone fallback above. To pin the
release and bypass a stale npx cache, run `npx -y planny-mcp@0.1.0`. If an older version
was cached, `npm cache clean --force` or the pinned version clears it.

### The server starts, then exits or the client shows no tools

Run the exact command from the client config in a terminal. The startup line must appear on
stderr. If it does not, the command or path is wrong. For npx, check that `npx -y
planny-mcp@0.1.0` works in a terminal. For a clone fallback, check that
`/absolute/path/to/planny/mcp/dist/index.js` exists and was produced by `bun run build`.
Do not point a Node client at `mcp/src/index.ts`; that is TypeScript. Point it at
`mcp/dist/index.js`, or use Bun to run the source.

### `connection refused` or `fetch failed`

`PLANNY_URL` must be an origin only:

```text
https://plans.example.com        correct
https://plans.example.com/       accepted; the trailing slash is trimmed
https://plans.example.com/plans  wrong; this is an upload endpoint
```

For a self-hosted instance, confirm it is reachable from the same machine as the client:
`curl -i "$PLANNY_URL/health"`. The hosted default needs no `PLANNY_URL` at all. If the
client is in a container or remote environment, `127.0.0.1` there is not your host.

### `401 missing_key` or `403 wrong_key`

The delete key is per plan, returned once by `publish_plan`, and sent as
`Authorization: Bearer <deleteKey>`. A missing or malformed header is `401`; a key for a
different plan is `403`. If the key was lost, the plan cannot be deleted early; it expires
on its own. Do not retry a wrong key in a loop, because delete attempts are rate-limited.

### `413` or "caps a plan at 4 MiB"

The raw HTML is over 4,194,304 bytes. The MCP layer rejects it before sending. Remove
embedded base64 images or split the document. The cap is measured on the raw body, not the
sanitised output, so stripping scripts does not make an oversized file acceptable.

### `429` rate limits

The defaults are 120 seconds between uploads from one address, 50 uploads per day and 500
per month. `address_upload_rate_limited` is the 120-second window;
`address_upload_daily_limit` and `address_upload_monthly_limit` are the daily and monthly
caps; `storage_limit` means the address's stored plans already fill its 1 GiB share. Wait
for the stated reset, delete old plans, or use a different network if you are testing.
Retrying immediately makes the wait longer.

### `503` paused, storage or monthly limit

`uploads_paused`, `storage_full` and `site_upload_monthly_limit` are service-wide. The
server message names the reset time when there is one. Do not retry in a loop; the MCP
server is working correctly when it returns these.

### Where the client logs are

- Claude Code: `claude mcp get planny`, `claude mcp list`, and `/mcp` inside a session.
- Claude Desktop: `~/Library/Logs/Claude/mcp-server-planny.log` on macOS, or
  `%APPDATA%\Claude\logs\mcp-server-planny.log` on Windows.
- Cursor: **Output → MCP Logs**.
- VS Code: **MCP: List Servers → Show Output**.
- Codex: restart after editing `config.toml`; check the terminal that launched Codex for
  startup errors.

## Directory manifests

`manifests/` holds prepared, unsubmitted metadata:

| File | Directory | Where it goes |
|---|---|---|
| `server.json` | official MCP registry, ingested by PulseMCP and mcp.so | repository root of the published package |
| `smithery.yaml` | Smithery | repository root of the repository Smithery builds |
| `glama.json` | Glama | repository root, to claim the listing |

PulseMCP and mcp.so ingest the official registry rather than accepting a separate manifest,
so `server.json` is the file that matters for them. The manifests reference
`planny-mcp@0.1.0`. Submit them after the 0.1.0 publish completes; nothing has been
submitted yet.
