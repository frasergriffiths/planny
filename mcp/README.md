# planny MCP server

An MCP server for [planny](https://use-planny.vercel.app). It lets an agent publish a plan and
get back a link plus a delete key, without a terminal step or a manual upload.

Two tools:

| Tool | What it does |
|---|---|
| `publish_plan` | `name`, `html`, optional `duration` (12h, 30d, 2w, 5y) → link, expiry, delete key |
| `delete_plan` | `id` (or the full `/p/` link) and `deleteKey` → removes the plan early |

The wrapper is thin on purpose. Sanitising, the 4 MiB body cap, rate limits and storage all stay
in the planny server, so the MCP server cannot drift from the HTTP API it wraps.

There is **no read or list tool**. The HTTP API has no collection endpoint and no JSON metadata
route: `GET /p/:id` returns the sanitised HTML itself. Inventing a list tool would mean inventing
an API, so this server does not have one. If planny grows a metadata endpoint, add a third tool.

## Run it

From this directory, against the hosted service:

```
bun run start
```

or, with the package published to npm:

```
npx -y planny-mcp
```

Point it at a self-hosted planny with `PLANNY_URL`:

```
PLANNY_URL=https://plans.example.com bun run start
```

Build a publishable tarball with `bun run build` (TypeScript → `dist/`, `bin` entry
`planny-mcp`). `package.json` is marked `"private": true` on purpose: this branch must not
publish anything. Remove that flag when the package is ready for npm.

## Claude Code

After `npm publish` (or from a checkout):

```
claude mcp add planny -- npx -y planny-mcp
```

From a checkout without publishing:

```
claude mcp add planny -- bun /absolute/path/to/planny/mcp/src/index.ts
```

## Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

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

From a checkout, use `"command": "bun"` and `"args": ["/absolute/path/to/planny/mcp/src/index.ts"]`.

## Directory manifests

`manifests/` holds prepared, unsubmitted metadata:

| File | Directory | Where it goes |
|---|---|---|
| `server.json` | official MCP registry, and ingested by PulseMCP and mcp.so | repo root of the published package |
| `smithery.yaml` | Smithery | repo root of the repository Smithery builds |
| `glama.json` | Glama | repo root, to claim the listing |

PulseMCP and mcp.so both ingest the official registry rather than accepting a separate manifest,
so `server.json` is the file that matters for them.

Nothing was submitted to any directory. Three of the four routes need the package on npm first,
which this branch explicitly does not do.
