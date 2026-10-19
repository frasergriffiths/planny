# planny

Plans for AI agents. An agent uploads one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only key. Nothing lists plans.

> This folder is the JavaScript parity reference and the rollback build. The TypeScript build in `ts/` is the live local service and the merge candidate. It runs on `127.0.0.1:4317` and has the agreed launch config and per-path pauses. See `ts/README.md`.

planny has two builds that share one app, one set of storage steps and one sanitiser:

- **Local**: runs on this Mac at `http://127.0.0.1:4317`, labelled LOCAL, as a background service.
- **Vercel**: `https://planny-pink.vercel.app`, with private Blob for the HTML, Upstash for records and counters, and Global Config for the upload switch. Not deployed yet; it waits on a Vercel login or token.

## Limits

- **Size:** 4 MiB per plan (4,194,304 bytes), the raw HTML with its embedded images included. The cap is measured on the raw body before cleaning, and the sanitiser adds a doctype and html/head/body wrapper, so a stored plan can be a few dozen bytes larger than what was sent.
- **Length:** 1 hour to 100 years, default 30 days. The 100-year cap is one setting, `PLANNY_MAX_PLAN_YEARS`. A year here is 365 days.
- **Name:** up to 120 characters.
- **Rate limits per address** (IPv6 counts by /56): 20 uploads an hour, 600 views a minute, 60 delete attempts an hour.
- **Storage:** 40 MB per address and 800 MB for the site. Past either, uploads are refused until plans are deleted or expire.
- **Monthly:** 1,500 uploads, 8,000 reads and 8 GB read. Past a read limit, plan pages show the paused page. Past the upload limit, uploads return a JSON 503. Both last until the first day of the next month.
- **Cache:** plan pages are cached at the CDN for 5 minutes (`PLANNY_CACHE_TTL_SECONDS`). Takedowns and author deletes purge the cache at once. Expiry follows the plan's end time. The TTL moves to 1 hour once the purge test passes on a preview.

## Use

Upload. The HTML is the raw body. The name and duration go in the query string.

```sh
curl -X POST "https://planny-pink.vercel.app/plans?name=Q4%20rollout&duration=90d" \
  -H "Content-Type: text/html" --data-binary @plan.html
```

The reply is JSON with `url`, `expiresAt`, `deleteKey` and the list of what was removed. The delete key is shown once. Store it.

Delete:

```sh
curl -X DELETE "<url>" -H "Authorization: Bearer <deleteKey>"
```

A plan can use HTML, CSS, inline SVG charts and images embedded as data URIs (PNG, JPEG, GIF, WebP or AVIF). The sanitiser removes scripts, forms, frames, external files, links (their text stays), meta refresh, base tags, event handlers and any URL that loads something. The upload reply names each kind it removed.

## Errors

Upload and delete return JSON: `{"error": {"code": "...", "message": "..."}}`. Plan pages return a page that says what happened and what to do next.

| Status | Code | When |
| --- | --- | --- |
| 400 | `name_required`, `name_too_long`, `invalid_duration`, `duration_too_short`, `duration_too_long`, `empty_body`, `invalid_encoding`, `too_deep` | The request is not valid. |
| 401 | `missing_key` | A delete has no `Authorization: Bearer` key. |
| 403 | `wrong_key` | The delete key does not match. |
| 404 | `no_plan` or a page | Unknown or malformed link, or a page that does not exist. |
| 405 | `method_not_allowed` | Wrong method for the path. |
| 409 | `busy` | The plan is already being removed. Try again. |
| 410 | `already_removed`, or a page | The plan expired, its author deleted it, or planny took it down. |
| 413 | `too_large` | The plan is over 4 MiB. |
| 415 | `unsupported_type` | The body is not `text/html` in UTF-8. |
| 429 | `rate_limited`, `storage_limit`, or a page | Too many requests, or the address has used its storage. |
| 500 | `upload_failed`, `upload_interrupted`, `server_error` | planny could not finish. Try again. |
| 503 | `uploads_paused`, `storage_full`, `uploads_monthly_limit`, or a paused page | Paused by the upload switch, a full site, or a monthly limit. |

## Local build

Runs on 127.0.0.1 only, so no other device can reach it. Plan data lives outside the repo, in `~/Library/Application Support/planny-local`.

```sh
npm install
npm run local:install      # start as a LaunchAgent (dev.planny.local), kept running at login
npm run local:status       # is it loaded and answering?
npm run local:uninstall    # remove the service; plan data is kept
npm run local:uninstall -- --purge   # also delete plan data, the address key and the log
```

The service runs only while the Mac is awake. A tunnel would expose this Mac, so none is set up. Admin commands write the same `state.json` the server uses, so run them when no upload is in flight.

Operator commands:

```sh
npm run admin -- takedown <plan-id>      # take a plan down now (410 "taken down")
npm run admin -- sweep                   # remove expired and abandoned plans
npm run admin -- uploads on|off|status   # the upload switch
```

## Vercel build

Needed in the Vercel project before the first deploy:

1. A **private** Blob store. The access mode cannot change later: `vercel blob create-store planny-plans --access private`.
2. **Upstash Redis** from the Vercel Marketplace. It sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. A **Global Config** store with an `uploadsEnabled` key (`true` allows uploads). Its connection string goes in `GLOBAL_CONFIG`.
4. `PLANNY_ADDRESS_KEY`: a random secret, for example `openssl rand -base64 32`.
5. Optional: `PLANNY_PUBLIC_ORIGIN`, `PLANNY_MAX_PLAN_YEARS`, `PLANNY_CACHE_TTL_SECONDS`. `.env.example` lists them.

Routing is in `vercel.json`: every path goes to `api/index.js`, and the static files in `public/` are served first. The function runs in `iad1`.

Deploy, after `vercel login` or with `VERCEL_TOKEN` set: `npx vercel --prod`. Nothing has been deployed yet. The CLI's dependencies list Node 20, 22 or 24; if `npx` warns or fails, run it under one of those.

The project's production branch must be `main`. Pushes to any other branch make preview deployments only.

Takedown on Vercel: `vercel env pull`, then `PLANNY_BUILD=vercel npm run admin -- takedown <plan-id>`.

## Code

- `api/index.js`: the Vercel function entry.
- `local/server.js`, `local/service.mjs`: the local server and its LaunchAgent script.
- `src/app.js`: routes, uploads, views, deletes and the lifecycle (expiry, abandoned uploads, takedowns).
- `src/sanitize.js`: the allowlist sanitiser and the CSS checks.
- `src/lua.js`: the atomic steps for reservations, claim markers, removal and rate limits. Both builds run this same Lua.
- `src/records.js`: record operations over the storage interface.
- `src/stores/local.js`: the local store (state file, fengari for the Lua, plan files on disk).
- `src/stores/vercel.js`: the Vercel store (Blob, Upstash, Global Config, cache purge with retry).
- `src/pages.js`: the site's pages. `public/planny.css` and `public/fonts/` hold the stylesheet and the fonts, Archivo and IBM Plex Mono, self-hosted under the SIL Open Font License.

## Security notes

- Client addresses are keyed with HMAC-SHA-256, and IPv6 counts by its /56. Addresses are not stored raw.
- Delete keys are random and stored only as SHA-256 hashes. They travel in the Authorization header, never in the URL.
- Plan pages are sent with `Content-Security-Policy: sandbox; default-src 'none'; ...`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Error pages are `no-store`.
- Vercel trusts `x-vercel-forwarded-for` only on Vercel. Local ignores all forwarded headers.
- Secrets are never in the repo. The local address key is in the data folder. Vercel secrets are environment variables. An empty or short address key stops startup.
- `npm audit` reports two moderate advisories in `sprintf-js`, pulled in by `fengari`. No fix is released yet. Only the local build loads `fengari`, and its Lua text is fixed in the repo, so no user input reaches it. Recheck when `fengari` updates.

## Tests

```sh
npm test
```

The suite runs 57 tests in temporary folders, so it never touches a live server. It covers the sanitiser against hostile markup, the storage steps and budgets (including concurrent reservations), every error page and its title, the rate limits, the upload switch, the monthly limits, expiry, abandoned uploads, takedown, the LaunchAgent file, the Vercel glue run against fakes, sweeps before a retry, query strings on plan links, failed blob deletes, deep nesting, the upload switch values, the address key, and client address handling.

Not yet tested, because they need the deployment: the real Blob, Upstash, Global Config and purge calls; the WAF rate limit; CDN cache headers on a preview; and the end-to-end check against the live URL.

## Open decisions

- Vercel login or token, and the plan: Hobby cannot carry public traffic, so Pro is the planned choice.
- Upstash: a hard stop on the free tier, or pay-as-you-go with a cap.
- Monthly budgets, and whether 4 MB per plan is enough.
- A footer contact address for reports. Scripts stay off.
- Whether the local build gets a tunnel, and whether the Mac stays awake.
- Whether a takedown can lag up to an hour if a purge fails. The TTL is 5 minutes until the purge test passes.
