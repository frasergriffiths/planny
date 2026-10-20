# planny

Plans for AI agents. An agent uploads one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only read key; there are no accounts and no list of plans.

> **Status:** early open-source project. The local app, tests and build work. The hosted service still has launch gates; see [Before launch](#before-launch). Treat the current public demo store as disposable, not production.

## How it works

1. An agent sends raw `text/html` to `POST /plans` with a name and a duration.
2. planny caps the body at 4 MiB and sanitises it: parse5 for the tree, PostCSS for the CSS, allowlists for elements, attributes, properties and at-rules. Scripts, links, forms, frames, remote resources and event handlers are removed.
3. The plan HTML is written to Vercel Blob, and a pending record is written to the state blob.
4. `GET /p/<uuid>` checks the record, reads the plan from Blob, and returns it with a sandboxed CSP and a cache tag.
5. `DELETE /p/<uuid>` compares the hashed delete key, removes the plan blob, marks the record deleted and purges the cache tag. An operator takedown uses the same removal path with the admin token.

The viewer is a plan, not an app: no scripts, no clickable links, no forms, no remote images, no external requests. The sample at `/sample` uses the same plan CSP with a user-activated top-level CTA.

## Limits

| Setting | Default |
| --- | --- |
| Plan size | 4 MiB (4,194,304 bytes), raw body, images included |
| Plan lifetime | 1 hour to 100 years, default 30 days (`PLANNY_MAX_PLAN_YEARS`) |
| Site storage | 100 GB (`PLANNY_SITE_BYTES`) |
| One address stores | 1 GB (`PLANNY_OWNER_BYTES`) |
| One address reads a month | 10 GB (`PLANNY_OWNER_MONTHLY_READ_BYTES`) |
| Monthly uploads | 5,000 (`PLANNY_MONTHLY_UPLOADS`) |
| Monthly origin reads | 1.5 million (`PLANNY_MONTHLY_READS`) |
| Monthly read bytes | 200 GB (`PLANNY_MONTHLY_READ_BYTES`) |
| Views per address | 20 a minute (`PLANNY_RATE_VIEWS_MAX`) |
| Uploads per address | 20 an hour, plus the daily/monthly and spacing checks |
| Delete attempts per address | 60 an hour |
| Admin calls per address | 10 a minute |
| CDN cache | 1 hour (`PLANNY_CACHE_TTL_SECONDS`), capped at the time left before expiry |

Reads and bytes are separate guards; whichever runs out first pauses new views. Pauses are per path: stored/upload guards stop uploads only, read guards stop new views only, and deletes, author deletes and admin routes keep working. The paused page names the guard and the reset date and is `no-store`.

## Routes

| Route | What it does |
| --- | --- |
| `GET /` | Home page. |
| `GET /sample` | The generated sample plan, with the plan CSP and a publish CTA. |
| `POST /plans?name=&duration=` | Upload raw `text/html`. Returns `url`, `expiresAt`, `deleteKey` and `removed`. |
| `GET /p/:uuid` | Show the plan. Query strings are a 404 and are not counted as reads. |
| `HEAD /p/:uuid` | The same headers, no body. |
| `DELETE /p/:uuid` | Delete with `Authorization: Bearer <deleteKey>`. |
| `POST /admin/plans/:uuid/remove` | Operator takedown. Needs `PLANNY_ADMIN_TOKEN`. |
| `POST /admin/reset` | Reset a monthly counter: `{"counter":"reads"|"bytes"|"uploads"|"all"}`. Needs the same token. |
| `GET /health` | Uncached build, runtime and configuration-presence flags. |
| `GET /terms-of-use` | Terms of use. The takedown contact still needs to be a monitored inbox. |

API errors are JSON: `{"error":{"code":"...","message":"..."}}`. Unknown, malformed and expired links get 404 and 410 pages, not JSON.

## Run it

```sh
bun install
cp .env.example .env.local   # only for local overrides; never commit real values
bun run test                 # typecheck, generated-file checks, tests and error registry
bun run dev                  # http://127.0.0.1:4317, or PLANNY_LOCAL_PORT
```

The local build keeps records, counters and rate windows in SQLite (`state.db`, WAL mode), plan files in `plans/`, and the address key outside the repo, in `~/Library/Application Support/planny-local`. An older `state.json` is migrated once and renamed `state.json.migrated`. It binds to `127.0.0.1` only and rejects any other Host header.

As a background service on this Mac:

```sh
bun run local:install
bun run local:status
bun run local:uninstall           # plan data stays
bun run local:uninstall -- --purge
```

The LaunchAgent (`dev.planny.local`) runs `bun local/server.ts` with `PLANNY_DATA_DIR`. If Bun or the repo moves, run install again.

Operator commands:

```sh
bun run admin takedown <uuid>
bun run admin sweep
bun run admin uploads on|off|status
bun run admin reset reads
PLANNY_BUILD=vercel bun run admin takedown <uuid>   # after vercel env pull
```

## Configuration

Copy `.env.example` to `.env.local` for local work. The production settings belong in Vercel, never in the repository.

Core production settings:

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read-write token. Required. It can read and write the whole store. |
| `BLOB_ACCESS` | `private` (recommended) or `public`. A public store exposes every object at its Blob URL. |
| `PLANNY_BLOB_KEY_1` | Stable HMAC key for public plan paths. Required only for a public store; rotating it breaks existing links. |
| `PLANNY_ADDRESS_KEY` | Stable keyed hash of client addresses for rates and pauses. Rotating it resets every derived address and every rate limit. |
| `PLANNY_ADMIN_TOKEN` | Operator token for takedown and reset. Treat it as a secret. |
| `PLANNY_PUBLIC_ORIGIN` | Canonical origin used in returned links. |

The optional limit variables are in `.env.example`, including the plan lifetime, cache TTL, storage and read budgets, and per-address rates. `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` are connection metadata, not app config.

The local SQLite store uses `PLANNY_DATA_DIR` and `PLANNY_LOCAL_PORT`; the Vercel deployment uses the Blob store. `PLANNY_BUILD`, `PLANNY_SHA` and `PLANNY_URL` are platform/runtime values.

## Blob-only trade-offs

There is one production store: Vercel Blob. There is no Upstash, Redis, Global Config or separate API folder.

- `state.json` is one JSON blob holding records, counters, rate windows and the small amount of control state. Each plan's HTML is a separate blob. `config/kill.json` is the upload switch.
- State changes are serialised by a create-only `state.lock` blob, with a 15-second stale-lock recovery. Each instance keeps the last state it wrote, with a monotonic sequence, so a read that lags a write does not lose the latest record.
- Blob reads can lag across instances. Do not delete a plan immediately after publishing another one and assume every instance sees the new state; re-read the state or wait for the read to settle.
- A single state blob means read-modify-write contention and a growth limit. It is simple and cheap for the current single-user/prototype shape, not for high write concurrency. The next shape is one record per plan plus a separate index.
- There is no multi-object transaction. A plan HTML blob and its state record can diverge if a process dies between writes. The pending record and the sweep handle orphans; a delete also removes the plan blob before marking the record.
- The Blob token is a large blast radius. A read-write token can read and write every plan and the state. Keep it in Vercel, rotate it if it is exposed, and never put it in a plan, a log or a screenshot.
- A public Blob store publishes every object at its Blob URL. The plan HMAC makes plan HTML paths unguessable; it does not protect `state.json` or `config/kill.json`. Use a private store, or add the state HMAC before enabling a public store.
- The edge cache is the only read cache. A view can be served from cache for up to the cache TTL (normally 1 hour); delete and takedown purge the plan tag, and the TTL is the fallback if a purge fails.
- Blob availability is service availability: a store failure returns a designed 503 rather than serving stale or unauthorised data.

See [`docs/architecture.md`](docs/architecture.md) for the request flow, the record lifecycle and the failure modes.

## Security model

- Plans are untrusted. The sanitiser and the sandboxed plan CSP are the boundary, not a cleanup step.
- The link is public to anyone who has it. There is no account, no session and no confidentiality promise. Do not put secrets or personal data in a plan.
- The delete key is returned once; only its hash is stored. The operator can take a plan down with `PLANNY_ADMIN_TOKEN`.
- Client addresses are used only through a keyed hash for rate limits and pauses. The raw address is not stored in the plan record.
- The Vercel Blob token and the admin token are secrets. The Blob token can read and write the whole store; a public store token also exposes objects directly.
- The deploy guard refuses to publish unless the Vercel project is Pro, and the production branch should stay `main`. Previews must not accept uploads.

For vulnerability reporting and the takedown route, see [`SECURITY.md`](SECURITY.md). The terms of use are at [`docs/terms-of-use.md`](docs/terms-of-use.md) and, once the React route ships, at `/terms-of-use`.

## Deploying on Vercel

The repo is the Vercel project root. `vercel.json` requests the Bun runtime, the LHR1 region and the `api/index.ts` function. The function builds the app lazily, so a missing setting produces the designed 503 rather than a load crash. `server.ts` is the local entry; `bun.lock` is committed for reproducible installs.

Needed in the project:

1. A Blob store in LHR1. A private store is the safe default; a public store needs the state HMAC/private-state check before launch.
2. Production environment variables: `BLOB_READ_WRITE_TOKEN`, `BLOB_ACCESS`, `PLANNY_BLOB_KEY_1` (only for a public store), `PLANNY_ADDRESS_KEY`, `PLANNY_ADMIN_TOKEN` and `PLANNY_PUBLIC_ORIGIN`. No Upstash or Global Config.

Production branch is `main`. A push to `main` deploys; any other branch makes a preview. Deploy by hand with `bun run scripts/deploy.ts`: it reads the project's plan and refuses unless it is Pro. `GET /health` is uncached and reports the build, runtime and which settings are present.

After the first deploy, on a preview check:

- Raw `text/html` arrives intact (not pre-parsed as JSON).
- A repeat view shows `x-vercel-cache: HIT`; 404s and 410s show `MISS`.
- A takedown purges its cache tag.
- `/health` reports the intended runtime (Bun) and the production environment.
- `/sample` is 200 with the plan CSP and the CTA.

Until those pass, keep the cache TTL at one hour as the fallback.

## Tests and CI

```sh
bun run test        # tsc --noEmit, generated tokens/sample checks, bun test, error registry
bun run build       # tokens, sample, Vite build and generated pages
bun test            # the test suite alone
```

The suite covers the sanitiser against hostile markup, plan states, limits and guards, the view path, rate limits and resets, error pages and headers, the local store and migration, the Vercel entry with a fake environment, the deploy guard, the token/sample generators, and the React card contract. The real Blob calls and cache purges need a deployed smoke test; they are not unit-testable without a Vercel project.

The CI workflow runs `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build` and `bun run test`. A release candidate should also show the live Blob tests as skipped without credentials, then pass the deployed smoke checks above.

## Project layout

```text
api/            Vercel function entry
src/            Hono app, stores, sanitiser, records, pages, limits
web/            React home, 404/410/503 pages and the Vite build
public/sample/  Sample body and generated sample
skills/planny/  The agent skill, plan template and component reference
scripts/        Generators, deploy, admin, load and parity helpers
local/          Local SQLite server and LaunchAgent
test/           Unit and integration tests
docs/           Architecture and terms copy
tokens.json     Card and chart token source
reference/      Frozen JavaScript build used for parity only; not deployed
```

## Before launch

The code is not publish-ready while these are open:

- The public-state HMAC/private-state check for a public Blob store, or a private store in production.
- Rotate the Blob token that was pasted into chat; assign the store firewall; confirm the Vercel project is Pro.
- Confirm `/health` reports Bun, not Node, and that the runtime setting actually applies.
- Implement the tombstone/record TTL, or keep the terms' honest indefinite-retention wording. The terms currently say the record is kept indefinitely.
- Rewrite the git history for the iCloud author email and local paths; remove the `js-reference` and `review-snapshot` tags; check PR refs; then make the repository public.
- Verify `/sample`, 404/410/purge and the 320px layout on the deployed build.
- Fill the terms' single takedown-contact placeholder.
- Have the launch limits reviewed and accepted.

## Open source

MIT licensed. See [`LICENSE`](LICENSE), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`docs/architecture.md`](docs/architecture.md) and [`docs/terms-of-use.md`](docs/terms-of-use.md).

The repository is still private until the history scan, author-email rewrite and tag cleanup are done. The hosted service should not be treated as production until the launch checks above pass.

## Design system

`tokens.json` is the source of truth for the card and chart values. `scripts/generate-tokens.ts` writes the Tailwind `@theme` and the plan template's `:root`; `scripts/generate-sample.ts` builds `public/sample/index.html` from the template and `public/sample/body.html`.

There are two card variants:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, 14px padding (16px text inset). The plan template uses `.box`/`.kpi`; the component reference uses `.card`; React uses `.plan-card`.
- `card-outline`: transparent, a full 1px `line` border, 12px `radius-card`, 15px padding (the same 16px inset). The plan template uses `.box.outline`/`.kpi.outline`; the component reference uses `.card--outline`; React uses `.plan-card-outline`.

Headings outside cards use the 16px inset; subheads inside cards use `.eyebrow` so they do not double it. The 6px swatch uses 3px, the bars and Gantt use 4px, and the budget segments keep 2px gaps.
