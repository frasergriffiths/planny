# planny

Plans for AI agents. An agent uploads one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only key. Nothing lists plans.

One TypeScript codebase at the repo root, run with Bun: Hono for the app, Zod at every edge, `bun test` for tests, strict TypeScript with no `any`. The old JavaScript build is kept, unchanged and self-contained, in `reference/` as a parity check. It isn't part of the app.

Design: black and white with one accent for status and focus, Geist and Geist Mono self-hosted under the OFL. The accent is blue, `#3291FF`.

## Limits at launch

| Setting | Value |
| --- | --- |
| Plan size | 4 MiB (4,194,304 bytes), raw body, images included |
| Plan length | 1 hour to 100 years, default 30 days. One setting, `PLANNY_MAX_PLAN_YEARS` |
| Site storage | 100 GB (`PLANNY_SITE_BYTES`) |
| One address stores | 1 GB (`PLANNY_OWNER_BYTES`) |
| One address reads a month | 10 GB (`PLANNY_OWNER_MONTHLY_READ_BYTES`) |
| Monthly uploads | 5,000 (`PLANNY_MONTHLY_UPLOADS`) |
| Monthly origin reads | 1.5 million (`PLANNY_MONTHLY_READS`) |
| Monthly read bytes | 200 GB (`PLANNY_MONTHLY_READ_BYTES`) |
| Views per address | 20 a minute (`PLANNY_RATE_VIEWS_MAX`) |
| Uploads per address | 20 an hour |
| Delete attempts per address | 60 an hour |
| Admin calls per address | 10 a minute |
| CDN cache | 1 hour (`PLANNY_CACHE_TTL_SECONDS`), capped at the time left before expiry |

Reads and bytes are separate guards: whichever runs out first pauses new views.

## Pauses are per path

- Stored or uploads guards stop uploads only. Views keep working.
- Read guards stop new views only. Cached views keep serving until their cache time.
- Deletes, author takedowns and the admin routes keep working while anything is paused, with an admin reset.
- The paused page names the guard and the reset date, and is `no-store`.

## Routes

| Route | What it does |
| --- | --- |
| `GET /` | Home page. |
| `POST /plans?name=&duration=` | Upload raw `text/html`. Returns `url`, `expiresAt`, `deleteKey` and `removed`. |
| `GET /p/:uuid` | Show the plan. Query strings are a 404 and are not counted as reads. |
| `GET /sample` | The sample plan, with the plan CSP and a publish CTA. |
| `HEAD /p/:uuid` | The same headers, no body. |
| `DELETE /p/:uuid` | Delete with `Authorization: Bearer <deleteKey>`. |
| `POST /admin/plans/:uuid/remove` | Operator takedown. Needs `PLANNY_ADMIN_TOKEN`. |
| `POST /admin/reset` | Reset a monthly counter: `{"counter":"reads"|"bytes"|"uploads"|"all"}`. Needs the same token. |

API errors are JSON: `{"error":{"code":"...","message":"..."}}`. Unknown, malformed and expired links get 404 and 410 pages, not JSON.

## Run it

```sh
bun install
bun run test        # tsc --noEmit, then bun test
bun run dev         # http://127.0.0.1:4317, or PLANNY_LOCAL_PORT
```

The local build keeps records, counters and rate windows in SQLite (`state.db`, WAL mode), plan files in `plans/`, and the address key outside the repo, in `~/Library/Application Support/planny-local`. An older `state.json` is migrated once and renamed `state.json.migrated`. It binds to `127.0.0.1` only and rejects any other Host header.

As the background service on this Mac:

```sh
bun run local:install
bun run local:status
bun run local:uninstall           # plan data stays
bun run local:uninstall -- --purge
```

The LaunchAgent (`dev.planny.local`) runs `bun local/server.ts` with `PLANNY_DATA_DIR`. If Bun moves or the repo folder moves, run install again.

Operator commands:

```sh
bun run admin takedown <uuid>
bun run admin sweep
bun run admin uploads on|off|status
bun run admin reset reads
PLANNY_BUILD=vercel bun run admin takedown <uuid>   # against Vercel's stores, after vercel env pull
```

## Parity and guard checks

`bun run tokens` rewrites the generated `:root` and Tailwind token blocks from `tokens.json`; `bun run sample` regenerates the sample from the template and `public/sample/body.html`. Both run as part of `bun run build`.

`bun run parity` starts the JS reference from `reference/` and this build on free ports, each with its own data folder, sends both 22 fixtures (pages, every upload error, a sanitised plan, query strings, the delete flow), and compares status, headers and bodies. It then runs the guard checks on this build: a 1-byte stored guard refuses an upload with `storage_full`, and a 1-read guard pauses views (`no-store`) while deletes and the admin reset still work.

Last run: 29 passed, 0 failed. Known divergence: the admin routes exist only in this build, so that case checks this side only.

`bun run scripts/load.ts` starts the local build and measures concurrency: 2,000 reads with 100 in flight, then 300 uploads with 25 in flight. Last run: 2,000 reads at about 3,350 a second, p95 40 ms; 300 uploads at about 1,380 a second, p95 23 ms; no failures. Numbers are from this Mac, not Vercel.

## Tests

`bun run test` runs `tsc --noEmit` and the test suite: the sanitiser against hostile markup, deep nesting, the plan states, every budget and limit, the view step with the per-plan counter and the monthly warning, the admin audit, rate limit and resets, the error pages, headers, the upload switch, the SQLite store and its migration from the old JSON file, 20 processes sharing one budget, the raw-body boundary, a 180-case adversarial matrix, the local entry (pages, CSS, Host check), the Vercel entry with a fake env, the deploy guard's fail-closed plan check, the uncached health route, and the Vercel store against fakes.

Not tested here: the real Blob calls and purge behaviour, and the preview cache behaviour. Those need the Vercel deployment.

## Deploying on Vercel

The repo is the Vercel project root. `vercel.json` sets the Bun runtime, the LHR1 region and the `api/index.ts` function. The function builds the app lazily, so a missing setting produces the designed 503 rather than a load crash. There is no Upstash, Global Config or separate API folder. `server.ts` is the local entry. `bun.lock` is committed so installs are reproducible.

Needed in the project:

1. A Blob store in LHR1. Public with the HMAC path, or private.
2. Environment variables, in Production only: `BLOB_READ_WRITE_TOKEN`, `BLOB_ACCESS=public`, `PLANNY_BLOB_KEY_1`, `PLANNY_ADDRESS_KEY`, `PLANNY_ADMIN_TOKEN`, `PLANNY_PUBLIC_ORIGIN=https://planny-pink.vercel.app`. `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` are connection metadata, not app config. There is no Upstash or Global Config.

Production branch is `main`. A push to `main` deploys; any other branch makes a preview. Deploy by hand with `bun run scripts/deploy.ts`: it reads the project's plan and refuses unless it is Pro, and refuses when it can't read the plan at all. `GET /health` is uncached and returns the build and runtime, so a deploy check can read the raw `x-vercel-id` from its response headers.

After the first deploy, on a preview: confirm the raw body arrives intact (`text/html` is not pre-parsed), a repeat view shows `x-vercel-cache: HIT`, 404s and 410s show MISS, and a takedown purges its tag. Until that passes, the TTL stays at one hour as a fallback.

## The `reference/` folder

The JavaScript build, frozen at its last reviewed commit, with its own `package.json`, tests and README. It exists so parity can be checked against a second implementation. It is not deployed and not maintained. Delete it once parity is no longer useful.

## Open decisions

- The launch limits need Fraser's yes; the 200 GB and 1.5M read guards bind at an average plan size of about 130 KB.
- A monitored contact address for takedown reports, before the terms page ships.
- The history rewrite and tag cleanup before the repository is made public.
- A tombstone retention period, if the terms are going to promise one.

## Open source

MIT licensed. See `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md` and `docs/architecture.md`. The repository is still private until the history scan and author-email rewrite are done.
