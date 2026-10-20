# Self-hosting planny

planny is one Hono app with two stores: SQLite for local development and Vercel
Blob for the hosted service. You can run it locally in a minute, or deploy your own
instance to Vercel. If you deploy it, you are the operator and the data controller
for that instance.

## Local

You need Bun 1.4 or newer. Node 22 or newer is fine for the production function.

```sh
git clone https://github.com/frasergriffiths/planny.git
cd planny
bun install --frozen-lockfile
bun run test
bun run dev
```

The app listens on `http://127.0.0.1:4317` unless `PLANNY_LOCAL_PORT` says
otherwise. It binds to `127.0.0.1` only and rejects any other `Host` header.

Local data lives in `~/Library/Application Support/planny-local` on macOS or the
directory in `PLANNY_DATA_DIR`. The local store is SQLite in WAL mode; plan files
are kept beside it. Copy `.env.example` to `.env.local` only if you need overrides,
and never commit it.

As a background service on macOS:

```sh
bun run local:install
bun run local:status
bun run local:uninstall            # plan data stays
bun run local:uninstall -- --purge # delete plan data too
```

## Vercel

### 1. Create the store

Create a Vercel Blob store in `lhr1`. Use a **private** store. A public store
exposes every object at its Blob URL; this repository has not implemented the
state HMAC that would make a public store safe, so do not use one.

### 2. Link the project

```sh
bunx vercel link
```

The repo is the project root. `vercel.json` sets the region and the function route.

### 3. Set the production environment

Set these in Vercel, not in a committed file:

| Variable | Value |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | The Blob read-write token. Treat it as a full-store secret |
| `BLOB_ACCESS` | `private` |
| `PLANNY_ADDRESS_KEY` | A stable secret, for example `openssl rand -base64 32` |
| `PLANNY_ADMIN_TOKEN` | An operator secret, for example `openssl rand -hex 32` |
| `PLANNY_PUBLIC_ORIGIN` | Your canonical origin, without a trailing slash |
| `PLANNY_BLOB_KEY_1` | Only for a public store; leave unset for a private store |

Rotating `PLANNY_ADDRESS_KEY` resets every derived address and every rate limit.
Rotating `PLANNY_BLOB_KEY_1` breaks existing public plan links. Treat both as
long-lived credentials.

The optional limit variables are documented in `.env.example` and the README.

### 4. Deploy

A push to `main` deploys. To deploy by hand:

```sh
bun run scripts/deploy.ts --prod
```

The script reads the project plan and refuses unless the project is Pro. It does
not deploy from a preview branch.

### 5. Verify

```sh
curl -s https://your-origin.example/health
```

Pass conditions:

- `ok` is `true` and `configured` is `true`;
- `access` is `private` and `accessConfigured` is `true` (this echoes the
  `BLOB_ACCESS` environment value only — it does not read the store's real ACL. Confirm
  in the Vercel dashboard that the Blob store itself is private);
- `runtime` matches the function runtime you expect (Node 24 on Vercel today);
- `purge` is `ok`;
- `blobToken`, `addressKey` and `adminToken` are `true`.

Then publish a test plan through the skill or `curl`, view it, delete it with the
delete key, and confirm the deleted link returns 410. Check `/sample`, `/terms-of-use`
and a 404 page. A repeat view should show `x-vercel-cache: HIT`; a 404 or 410 should
show `MISS`.

## Your responsibilities as the operator

- Replace the contact in `docs/terms-of-use.md`, `PRIVACY.md`, `ACCEPTABLE_USE.md`
  and `CODE_OF_CONDUCT.md` with an inbox you monitor.
- Publish your own terms and privacy notice; do not imply that Fraser Griffiths
  operates your instance.
- Keep the takedown and security routes working, and answer reports.
- Review the limits in the README for your traffic and budget.
- Keep the Blob token, address key and operator token out of the repository, logs,
  screenshots and plans.
- Rotate the Blob token immediately if it is ever exposed.

## Troubleshooting

- **`/health` says `configured: false`** — one required setting is missing. The
  `error` field names the first missing setting; it never prints a value.
- **`/health` says `access: public`** — `BLOB_ACCESS` is set to `public`. Stop and set
  it to `private` (or move the store to private), then verify the store is private in the
  Vercel dashboard: the health value follows the env var, not the store.
- **A deploy is refused** — the Vercel project is not Pro, or the CLI is not signed
  in. The deploy guard fails closed on purpose.
- **A plan returns 503** — the store is unavailable or a guard is paused. The page
  names the guard and the reset date.
- **A delete returns 404 after a successful publish** — Blob reads can lag across
  instances. Wait a moment or re-read the state; see `docs/architecture.md`.
