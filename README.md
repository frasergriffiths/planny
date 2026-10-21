# planny

[![skills.sh](https://skills.sh/b/frasergriffiths/planny)](https://www.skills.sh/frasergriffiths/planny)

Plans for AI agents. An agent uploads one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only read key; there are no accounts and no list of plans.

Try it at https://use-planny.vercel.app.

## Storage

Self-host with either production store. Both work on Vercel.

| Store | `PLANNY_STORE` | Required | Notes |
| --- | --- | --- | --- |
| Vercel Blob | `blob` or unset | `BLOB_READ_WRITE_TOKEN` | Default. Use a private store. |
| Neon Postgres | `postgres` | `DATABASE_URL`, `PLANNY_ADDRESS_KEY` | No Blob token needed. |
| SQLite | not used | none | Local development only. |

The hosted service uses Neon Postgres. To self-host with Blob, set `PLANNY_STORE=blob` or leave it unset and provide the Blob token. To use Neon, connect a Neon database and set `PLANNY_STORE=postgres` plus `DATABASE_URL`. Full steps are in [self-hosting](docs/self-hosting.md).

Start with [Run it](#run-it), [self-hosting](docs/self-hosting.md), [architecture](docs/architecture.md), [terms of use](docs/terms-of-use.md), [privacy](PRIVACY.md), [acceptable use](ACCEPTABLE_USE.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md), the [operator runbook](docs/runbook.md) and the [changelog](CHANGELOG.md).

## Install the agent skill

```
npx skills add frasergriffiths/planny --skill planny
```

One command installs the skill into Claude Code, Cursor, Codex, OpenCode and other skill agents. Add `-g` to install it globally. Runs on Node 22+ or Bun (`bunx skills add frasergriffiths/planny --skill planny`). Set `PLANNY_URL` in the agent's environment to publish to a self-hosted instance instead of the hosted default. See the [skills.sh page](https://www.skills.sh/frasergriffiths/planny/planny) and the [skill source](https://github.com/frasergriffiths/planny/tree/main/skills/planny).

The skill ships four plan templates: [project](skills/planny/template.html), [launch](skills/planny/templates/launch-plan.html), [research](skills/planny/templates/research-plan.html) and [decision](skills/planny/templates/decision-plan.html). Every plan is organised as four numbered tasks, from the first step to the finish. The skill also bundles the [unslop rules](skills/planny/reference/unslop.md) and requires the agent to apply them to every visible word before publishing.

Plans can include a styled code block with static syntax highlighting and a Copy button added by the viewer, plus an inline [Heroicons set](skills/planny/reference/icons.md). The [component reference](skills/planny/reference/components.md) documents both.

## How it works

1. An agent sends raw `text/html` to `POST /plans` with a name and a duration.
2. planny caps the body at 4 MiB and sanitises it: parse5 for the tree, PostCSS for the CSS, allowlists for elements, attributes, properties and at-rules. Scripts, links, forms, frames, remote resources and event handlers are removed.
3. The plan HTML and a pending record are written to the selected store (Vercel Blob by default, or Postgres).
4. `GET /p/<uuid>` checks the record, reads the plan from the store, and returns it with a sandboxed CSP and a cache tag.
5. `DELETE /p/<uuid>` compares the hashed delete key, removes the plan file, marks the record deleted and purges the cache tag. An operator takedown uses the same removal path.

The viewer is a plan, not an app: no plan-authored scripts; one fixed copy script is injected by the viewer. No plan-authored links, forms, remote images or external requests. Each plan ends with one viewer line, "Made with Planny", which links to the hosted service; 404 and 410 plan pages invite the reader to publish their own. The sample at `/sample` uses the plan CSP with a user-activated top-level CTA.

The footer is the viewer's markup, added after the sanitiser, so it never enters the stored plan, and plan CSS cannot restyle, hide or cover it. Set `PLANNY_ATTRIBUTION=off` for a self-hosted instance that should not show it.

## Limits

| Setting | Scope | Default |
| --- | --- | --- |
| Plan size | per plan | 4 MiB (4,194,304 bytes), raw body, images included |
| Plan lifetime | per plan | 1 hour to 100 years, default 30 days (`PLANNY_MAX_PLAN_YEARS`) |
| Site storage | site-wide | 100 GiB (`PLANNY_SITE_BYTES`) |
| One address stores | per address | 1 GiB (`PLANNY_OWNER_BYTES`) |
| One address reads a month | per address | 10 GiB (`PLANNY_OWNER_MONTHLY_READ_BYTES`) |
| Monthly uploads | site-wide | 5,000 (`PLANNY_MONTHLY_UPLOADS`) |
| Monthly origin reads | site-wide | 1.5 million (`PLANNY_MONTHLY_READS`) |
| Monthly read bytes | site-wide | 200 GiB (`PLANNY_MONTHLY_READ_BYTES`) |
| Views per address | per address | 20 a minute (`PLANNY_RATE_VIEWS_MAX`) |
| Uploads per address | per address | 20 an hour, plus the daily/monthly and spacing checks |
| Delete attempts per address | per address | 60 an hour |
| Operator calls per address | per address | 10 a minute |
| CDN cache | per plan | 1 hour (`PLANNY_CACHE_TTL_SECONDS`), capped at the time left before expiry |

Reads and bytes are separate guards; whichever runs out first pauses new views. Pauses are per path: stored/upload guards stop uploads only, read guards stop new views only, and deletes, author deletes and operator routes keep working. The paused page names the guard and the reset date and is `no-store`.

## Routes

| Route | What it does |
| --- | --- |
| `GET /` | Home page. |
| `GET /sample` | The generated sample plan, with the plan CSP and a publish CTA. |
| `POST /plans?name=&duration=` | Upload raw `text/html`. Returns `url`, `expiresAt`, `deleteKey` and `removed`. |
| `GET /p/:uuid` | Show the plan. Query strings are a 404 and are not counted as reads. |
| `HEAD /p/:uuid` | The same headers, no body. |
| `DELETE /p/:uuid` | Delete with `Authorization: Bearer <deleteKey>`. |
| `GET /health` | Uncached build, runtime and configuration-presence flags. |
| `GET /terms-of-use` | 301 redirect to the canonical terms document at `docs/terms-of-use.md` on GitHub. |
| `GET /.well-known/security.txt` | Machine-readable security contact. |

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
| `PLANNY_STORE` | `blob` (default) or `postgres`. |
| `DATABASE_URL` | Neon connection string, required for `PLANNY_STORE=postgres`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read-write token. Required in Blob mode. It can read and write the whole store. |
| `BLOB_ACCESS` | `private` or `public`. Production requires `private`: a public store exposes every object at its Blob URL, including `state.json` and `config/kill.json`. |
| `PLANNY_BLOB_KEY_1` | Stable HMAC key for public plan paths. Set it for a public store; if unset, the Blob token is used and rotating it breaks existing links. |
| `PLANNY_ADDRESS_KEY` | Recommended stable keyed hash of client addresses for rates and pauses. If unset, the Blob token is used; rotating either resets every derived address and rate limit. |
| `PLANNY_PUBLIC_ORIGIN` | Canonical origin used in returned links. Defaults to `https://use-planny.vercel.app`; set it for a self-hosted instance. |
| `PLANNY_ATTRIBUTION` | `on` (default) adds the "Made with Planny" footer to each plan and the publish line to 404/410 pages. Set `off` to remove both. |

The optional limit variables are in `.env.example`, including the plan lifetime, cache TTL, storage and read budgets, and per-address rates. `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` are connection metadata, not app config. Operator settings for takedown and reset are covered in the [self-hosting guide](docs/self-hosting.md).

The local SQLite store uses `PLANNY_DATA_DIR` and `PLANNY_LOCAL_PORT`; the Vercel deployment uses `PLANNY_STORE` to choose Blob (the default) or Postgres. `PLANNY_BUILD` and `PLANNY_SHA` are platform/runtime values; the skill scripts (`skills/planny/scripts/publish.mjs`, `delete.mjs`) read `PLANNY_URL` (or `PLANNY_BASE`) only as an optional base-URL override for the planny origin.

## Storage options

Both Vercel Blob and Neon Postgres are supported for self-hosting. Blob is the default when `PLANNY_STORE` is unset; the hosted service sets `PLANNY_STORE=postgres`. Set `PLANNY_STORE=postgres` and provide `DATABASE_URL` to use Neon. Blob stays selectable, and the local build keeps SQLite.

Postgres mode needs `PLANNY_ADDRESS_KEY` and does not need `BLOB_READ_WRITE_TOKEN`. The store keeps the same state engine in one locked row, so each write is a real transaction instead of a Blob lock file. Plans live in `planny_plans` as `bytea`.

## Blob trade-offs

The default production store is Vercel Blob.

- `state.json` is one JSON blob holding records, counters, rate windows and the small amount of control state. Each plan's HTML is a separate blob. `config/kill.json` is the upload switch.
- State changes are serialised by a create-only `state.lock` blob, with a 15-second stale-lock recovery. Each instance keeps the last state it wrote, with a monotonic sequence, so a read that lags a write does not lose the latest record.
- Blob reads can lag across instances. Do not delete a plan immediately after publishing another one and assume every instance sees the new state; re-read the state or wait for the read to settle.
- A single state blob means read-modify-write contention and a growth limit. It is simple and cheap for a small service, not for high write concurrency. The next shape is one record per plan plus a separate index.
- There is no multi-object transaction. A plan HTML blob and its state record can diverge if a process dies between writes. The pending record and the sweep handle orphans; a delete also removes the plan blob before marking the record.
- The Blob token is a large blast radius. A read-write token can read and write every plan and the state. Keep it in Vercel, rotate it if it is exposed, and never put it in a plan, a log or a screenshot.
- A public Blob store publishes every object at its Blob URL. The plan HMAC makes plan HTML paths unguessable; it does not protect `state.json` or `config/kill.json`. Use a private store, or add the state HMAC before enabling a public store.
- The edge cache is the only read cache. A view can be served from cache for up to the cache TTL (normally 1 hour); delete and takedown purge the plan tag, and the TTL is the fallback if a purge fails.
- Blob availability is service availability: a store failure returns a designed 503 rather than serving stale or unauthorised data.

See [`docs/architecture.md`](docs/architecture.md) for the request flow, the record lifecycle and the failure modes.

## Security model

- Plans are untrusted. The sanitiser and the sandboxed plan CSP are the boundary, not a cleanup step.
- The link is public to anyone who has it. There is no account, no session and no confidentiality promise. Do not put secrets or personal data in a plan.
- The delete key is returned once; only its hash is stored. The operator can take a plan down.
- Client addresses are used only through a keyed hash for rate limits and pauses. The raw address is not stored in the plan record.
- The Vercel Blob token is a secret. It can read and write the whole store; a public store token also exposes objects directly.
- The optional deploy helper refuses to deploy unless the Vercel project is Pro; Vercel itself does not enforce that check. The production branch should stay `main`, and previews must not accept uploads.

For vulnerability reporting and the takedown route, see [`SECURITY.md`](SECURITY.md). The canonical terms are [`docs/terms-of-use.md`](docs/terms-of-use.md); `/terms-of-use` returns a 301 there.

## Deploying on Vercel

The repo is the Vercel project root. `vercel.json` sets the LHR1 region and routes requests to `api/index.ts`. Vercel serves the function on Node 24 today; Bun runs local development and the tests. The function builds the app lazily, so a missing setting produces the designed 503 rather than a load crash. `server.ts` is the local entry; `bun.lock` is committed for reproducible installs. See [`docs/self-hosting.md`](docs/self-hosting.md) for the full setup.

Needed in the project:

1. A Blob store in LHR1. A private store is the safe default; a public store exposes every object at its Blob URL.
2. Production environment variables: `BLOB_READ_WRITE_TOKEN`, `BLOB_ACCESS=private`, `PLANNY_ADDRESS_KEY`, `PLANNY_PUBLIC_ORIGIN` and, only for a public store, `PLANNY_BLOB_KEY_1`. The operator token required for takedown and reset is documented in the [self-hosting guide](docs/self-hosting.md). Only the Blob token is required to serve and publish.

Production branch is `main`. A push to `main` deploys when the Vercel project is connected to the GitHub repository; any other branch makes a preview. Check `/health` after a minute; if the push did not produce a deployment, deploy by hand with `bunx vercel@latest --prod --yes`, or use the optional `bun run scripts/deploy.ts --prod` helper, which refuses unless the project is Pro. `GET /health` is uncached and reports the build, runtime, commit and which settings are present.

On a production check:

- Raw `text/html` arrives intact (not pre-parsed as JSON).
- A repeat view shows `x-vercel-cache: HIT`; 404s and 410s show `MISS`.
- A takedown purges its cache tag.
- `/health` reports the runtime it is actually using (Node 24 today) and the production environment.
- `/sample` is 200 with the plan CSP and the CTA.

Keep the cache TTL at one hour as the fallback while those checks are proving out.

## Tests and CI

```sh
bun run test        # tsc --noEmit, generated tokens/sample checks, bun test, error registry
bun run build       # tokens, sample, Vite build and generated pages
bun test --isolate --concurrency=1   # the test suite alone
```

The suite covers the sanitiser against hostile markup, plan states, limits and guards, the view path, rate limits and resets, error pages and headers, the local store and migration, the Vercel entry with a fake environment, the deploy helper, the token/sample generators, and the React card contract. The real Blob calls and cache purges need a deployed smoke test; they are not unit-testable without a Vercel project.

CI runs `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun test --isolate --concurrency=1`, then the token, sample and skill-error checks (`bun run scripts/generate-tokens.ts --check`, `bun run scripts/generate-sample.ts --check` and `bun run scripts/generate-skill-errors.ts --check`). The five Live Blob tests skip without credentials; that is expected in CI. A release candidate should also show the live Blob tests as skipped without credentials, then pass the deployed smoke checks above.

## Project layout

```text
api/            Vercel function entry
src/            Hono app, stores, sanitiser, records, pages, limits
web/            React home, 404/410/503 pages and the Vite build
public/sample/  Sample body and generated sample
skills/planny/  The agent skill, four plan templates and the component and writing references
scripts/        Generators, deploy and admin helpers
local/          Local SQLite server and LaunchAgent
test/           Unit and integration tests
docs/           Architecture and terms copy
tokens.json     Card and chart token source
```

## Open source

The code is MIT licensed. The Geist fonts in [`public/fonts`](public/fonts) are under the SIL Open Font License; see [`public/fonts/OFL-geist.txt`](public/fonts/OFL-geist.txt). Third-party package licences are collected in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Also see [`LICENSE`](LICENSE), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`SECURITY.md`](SECURITY.md), [`PRIVACY.md`](PRIVACY.md), [`ACCEPTABLE_USE.md`](ACCEPTABLE_USE.md), [`docs/architecture.md`](docs/architecture.md) and [`docs/terms-of-use.md`](docs/terms-of-use.md).

## Design system

`tokens.json` is the source of truth for the card and chart values. `scripts/generate-tokens.ts` writes the Tailwind `@theme` and the plan template's `:root`; `scripts/generate-sample.ts` builds `public/sample/index.html` from the template and `public/sample/body.html`.

There are two card variants:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, 14px padding (16px text inset). The plan template uses `.box`/`.kpi`; the component reference uses `.card`; React uses `.plan-card`.
- `card-outline`: transparent, a full 1px `line` border, 12px `radius-card`, 15px padding (the same 16px inset). The plan template uses `.box.outline`/`.kpi.outline`; the component reference uses `.card--outline`; React uses `.plan-card-outline`.

Headings outside cards use the 16px inset; subheads inside cards use `.eyebrow` so they do not double it. The 6px swatch uses 3px, the bars and Gantt use 4px, and the budget segments keep 2px gaps.
