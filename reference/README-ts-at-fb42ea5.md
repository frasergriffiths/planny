# planny (TypeScript)

Plans for agents, rewritten in TypeScript: Hono for the app, Zod at every edge, Vitest for tests, strict mode and no `any`. The JavaScript build at the repo root is the parity reference; this folder is the merge candidate.

Same product and the same rules as the reference: one HTML file in, one link out. The differences are the agreed launch config and the per-path pauses.

This build is now the service on `127.0.0.1:4317` (LaunchAgent `dev.planny.local`). The JS reference's LaunchAgent is replaced; its data was backed up to `~/Library/Application Support/planny-local.backup-<timestamp>` and its plist to `.reference/dev.planny.local.reference.plist`. To roll back, copy that plist to `~/Library/LaunchAgents/dev.planny.local.plist` and run `launchctl kickstart -k gui/$(id -u)/dev.planny.local` from the repo root.

Local builds take rate-limit overrides from the environment, so tests and parity runs can raise them without touching the live defaults: `PLANNY_RATE_UPLOADS_MAX`, `PLANNY_RATE_UPLOADS_WINDOW`, `PLANNY_RATE_VIEWS_MAX`, `PLANNY_RATE_VIEWS_WINDOW`. The live service keeps the launch limits.

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
| Views per address | 10 a minute |
| Uploads per address | 20 an hour |
| Delete attempts per address | 60 an hour |
| Admin calls per address | 10 a minute |
| CDN cache | 1 hour (`PLANNY_CACHE_TTL_SECONDS`), capped at the time left before expiry |

Reads and bytes are separate guards: whichever runs out first pauses new views.

## Pauses are per path

- Stored or uploads guards stop uploads only. Views keep working.
- Read guards stop new views only. Cached views keep serving until their cache time.
- Deletes, author takedowns and the admin routes keep working while anything is paused.
- The paused page names the guard and the reset date, and is `no-store`.

## Routes

| Route | What it does |
| --- | --- |
| `GET /` | Home page. |
| `POST /plans?name=&duration=` | Upload raw `text/html`. Returns `url`, `expiresAt`, `deleteKey` and `removed`. |
| `GET /p/:uuid` | Show the plan. Query strings are a 404 and are not counted as reads. |
| `HEAD /p/:uuid` | The same headers, no body. |
| `DELETE /p/:uuid` | Delete with `Authorization: Bearer <deleteKey>`. |
| `POST /admin/plans/:uuid/remove` | Operator takedown. Needs `PLANNY_ADMIN_TOKEN`. |
| `POST /admin/reset` | Reset a monthly counter: `{"counter":"reads"|"bytes"|"uploads"|"all"}`. Needs the same token. |

API errors are JSON: `{"error":{"code":"...","message":"..."}}`. Unknown, malformed and expired links get 404 and 410 pages, not JSON.

## Local build

```sh
npm install
npm run test        # type check, then Vitest
npm run dev         # http://127.0.0.1:4317, or PLANNY_LOCAL_PORT
```

To install it as the LaunchAgent on this Mac (it replaces the reference's agent):

```sh
npm run build
node_modules/.bin/tsx local/service.ts install
node_modules/.bin/tsx local/service.ts status
node_modules/.bin/tsx local/service.ts uninstall          # plan data stays
node_modules/.bin/tsx local/service.ts uninstall --purge  # delete plan data too
```

The launchd job runs `tsx local/server.ts` with `PLANNY_DATA_DIR`. If nvm drops this Node version, or this folder moves, run install again.

Admin commands, local:

```sh
node_modules/.bin/tsx scripts/admin.ts takedown <uuid>
node_modules/.bin/tsx scripts/admin.ts sweep
node_modules/.bin/tsx scripts/admin.ts uploads on|off|status
node_modules/.bin/tsx scripts/admin.ts reset reads
```

## Parity and guard checks

`npm run parity` starts this build next to the JS reference already running on `127.0.0.1:4317`, sends both the same 22 fixtures (pages, upload errors, a sanitised plan, query strings, delete flow), and compares status, headers and bodies. It then runs the guard checks on its own build: a 1-byte stored guard refuses an upload with `storage_full`, and a 1-read guard pauses views (`no-store`) while deletes and the admin reset still work.

## Tests

`npm test` runs `tsc --noEmit` and 31 Vitest tests: the sanitiser against hostile markup (including Lens's 177-payload set in the reference), deep nesting, the six plan states, every budget and limit, the view step with the per-plan counter and the monthly warning, the admin reset, the error pages, headers, the upload switch, and the Vercel store against fakes.

Not tested here: the real Blob, Upstash, Global Config and purge calls, and the preview cache behaviour. Those need the Vercel deployment.

## Deploying

The Vercel project's Root Directory must be `ts`. The project needs a **private** Blob store in LHR1, Upstash in `eu-west-2`, a Global Config store with `uploadsEnabled` set to `true`, and these environment variables: `PLANNY_ADDRESS_KEY`, `PLANNY_ADMIN_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GLOBAL_CONFIG`, plus `PLANNY_PUBLIC_ORIGIN` if the domain changes.

Deploy after `vercel login` or with `VERCEL_TOKEN`: `npx vercel --prod`. Nothing is deployed yet. Production branch must be `main`.

## Decisions still open

- The $20 Upstash cap and the launch limits above need Fraser's yes.
- The footer address, if wanted at launch.
- Whether the 200 GB and 1.5M read guards are the right pair (the bytes guard binds first above an average plan size of about 130 KB).
