# Self-hosting planny

planny is one Hono app with three stores: SQLite for local development, and either
Vercel Blob or Neon Postgres for a deployed instance. You can run it locally in a
minute, or deploy your own instance to Vercel. If you deploy it, you are the
operator and the data controller for that instance.

## Local

You need Bun 1.4 or newer. Node 22 or newer is fine for the production function. The agent skill scripts run on Node 22+ or Bun.

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

### 1. Choose a store

Both production stores are supported. Pick one for the instance.

**Vercel Blob (default).** Create a private Blob store in `lhr1` and set
`BLOB_READ_WRITE_TOKEN`. Leave `PLANNY_STORE` unset or set it to `blob`. A public
store exposes every object at its Blob URL; do not use one.

**Neon Postgres.** Connect a Neon database to the project, set
`PLANNY_STORE=postgres` and `DATABASE_URL`, and set `PLANNY_ADDRESS_KEY`. Postgres
mode does not need `BLOB_READ_WRITE_TOKEN`. The app creates the three tables on
first use.

You can switch later by changing `PLANNY_STORE`. The stores are separate, so plans
in one are not visible in the other.

### 2. Link the project

```sh
bunx vercel link
```

The repo is the project root. `vercel.json` sets the region and the function route.

### 3. Set the production environment

Set these in Vercel, not in a committed file:

| Variable | Value |
| --- | --- |
| `PLANNY_STORE` | `blob` (default) or `postgres` |
| `DATABASE_URL` | The Neon connection string when `PLANNY_STORE=postgres` |
| `BLOB_READ_WRITE_TOKEN` | The Blob read-write token. Required for `PLANNY_STORE=blob` |
| `BLOB_ACCESS` | `private` |
| `PLANNY_ADDRESS_KEY` | A stable secret, for example `openssl rand -base64 32` |
| `PLANNY_ADMIN_TOKEN` | An operator secret, for example `openssl rand -hex 32` |
| `PLANNY_PUBLIC_ORIGIN` | Your canonical origin, without a trailing slash |
| `PLANNY_BLOB_KEY_1` | Only for a public store; leave unset for a private store |

`BLOB_READ_WRITE_TOKEN` is required in Blob mode; Postgres mode requires `DATABASE_URL` and `PLANNY_ADDRESS_KEY` instead. `PLANNY_ADDRESS_KEY` is recommended in Blob mode; if it is unset, the Blob token is used as the address-hash key.
`PLANNY_ADMIN_TOKEN` is required only for takedown and reset. Rotating
`PLANNY_ADDRESS_KEY` resets every derived address and every rate limit. Rotating
`PLANNY_BLOB_KEY_1` breaks existing public plan links. Treat both as long-lived
credentials.

The optional limit variables are documented in `.env.example` and the README.

### 4. Deploy

A push to `main` deploys when the Vercel project is connected to the GitHub
repository. Check `/health` after a minute; if the push did not produce a
deployment, deploy by hand:

```sh
bunx vercel@latest --prod --yes
```

The optional helper `bun run scripts/deploy.ts --prod` refuses unless the
checked-out branch is `main` and the linked project is Pro. It is stricter than
Vercel; a Hobby project can still be deployed with `vercel --prod` if you accept
its limits. The helper does not deploy from a preview branch.

### 5. Verify

```sh
curl -s https://your-origin.example/health | jq '{commit, configured, access, purge}'
```

Pass conditions:

- `ok` is `true` and `configured` is `true`;
- `access` is `private` and `accessConfigured` is `true` (this echoes the
  `BLOB_ACCESS` environment value only — it does not read the store's real ACL. Confirm
  in the Vercel dashboard that the Blob store itself is private);
- `runtime` matches the function runtime you expect (Node 24 on Vercel today);
- `purge` is `ok`;
- `blobToken` is `true`;
- `addressKey` and `adminToken` are `true` if you set them; `addressKey` is
  recommended, and `adminToken` is required only for takedown and reset.

Only `BLOB_READ_WRITE_TOKEN` is required to serve and publish. The health route
reports whether a value is present, not whether it is valid. If
`PLANNY_ADDRESS_KEY` is unset, the Blob token is used as the address-hash key, so
rotating the Blob token also resets the rate limits.

Then publish a test plan through the skill or `curl`, view it, delete it with the
delete key, and confirm the deleted link returns 410. Check `/sample`, the
`/terms-of-use` redirect to GitHub, and a 404 page. A repeat view should show
`x-vercel-cache: HIT`; a 404 or 410 should show `MISS`.

### 6. Optional: install the agent skill

The public skill defaults to the hosted service. To use it with your instance:

```sh
npx skills add frasergriffiths/planny --skill planny
```

Set `PLANNY_URL=https://your-origin.example` in the environment where the agent
runs, or pass `--base https://your-origin.example` to
`skills/planny/scripts/publish.mjs`. The delete script uses the origin stored in
the plan's key file, so it deletes from the instance that published the plan.

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
- **A deploy is refused** — the optional helper requires a Pro project and a
  signed-in CLI. It fails closed on purpose. Use `bunx vercel@latest --prod --yes`
  to deploy a Hobby project directly, if you accept the Hobby limits.
- **A plan returns 503** — the store is unavailable or a guard is paused. The page
  names the guard and the reset date.
- **A delete returns 404 after a successful publish** — Blob reads can lag across
  instances. Wait a moment or re-read the state; see `docs/architecture.md`.
