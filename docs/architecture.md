# Architecture

planny is a single TypeScript service. It accepts one HTML file, sanitises it, stores it in Vercel Blob, and serves it at an unguessable link until it expires or is deleted. Bun runs local development, tests and builds; the production function runs on Vercel's Node 24 runtime, and `/health` reports the runtime actually in use.

This document describes the current design and its trade-offs.

## Request flow

```text
POST /plans
  -> rate, upload-gate and storage guards
  -> read the raw body (4 MiB cap)
  -> sanitise: parse5 tree, PostCSS CSS, allowlists
  -> write plans/<uuid>-<hmac>.html to Blob
  -> write the pending record to state.json
  -> return url, expiresAt and deleteKey

GET /p/<uuid>
  -> read the record from state.json
  -> pending, missing, expired, deleted or taken down -> 404 or 410
  -> read the plan HTML from Blob
  -> return it with the plan CSP and a cache tag

DELETE /p/<uuid>
  -> compare the hashed delete key
  -> remove the plan blob
  -> mark the record gone and purge the cache tag

POST /admin/plans/<uuid>/remove
  -> check the admin token and address rate
  -> mark the record hidden, remove the plan blob, purge the tag
```

`HEAD` follows the view path and returns the same headers without a body. `/p/<uuid>/raw` redirects to `/p/<uuid>`. `/sample` is generated from the template and the sample body and is served with the plan CSP plus the publish CTA. Query strings on a plan are a 404 and are not counted as reads.

## Storage

There is one production store: Vercel Blob. It holds:

- `plans/<uuid>-<hmac>.html`: the plan HTML, with an HMAC suffix when the store is public.
- `state.json`: records, counters, rate windows and control state.
- `config/kill.json`: the upload switch.

`src/stores/blob.ts` adapts the Blob API to the small key-value interface used by the app. The state is one JSON blob. The simple shape is a deliberate trade-off: no second service to run, at the cost of read-modify-write contention, a growth limit and cross-instance read lag.

State writes take a create-only `state.lock` blob. The lock is considered stale after 15 seconds and is recovered. Each instance keeps the last state it wrote, with a monotonic sequence, so a read that lags a write does not lose the latest record. The long-term shape is one record per plan plus a separate index; that removes the single-state write window.

The plan HTML and the state record are separate objects. A process can die after the plan write but before the pending record, leaving an orphan; the sweep handles those. A delete removes the plan HTML first and then marks the record gone, so a failed state write cannot leave a readable plan under a live record.

### Public versus private Blob

A private store is the safe default. A public Vercel Blob store exposes every object at its Blob URL. The HMAC suffix makes plan HTML names unguessable, but `state.json` and `config/kill.json` have no such protection. Use a private store, or implement the state HMAC before making the store public.

The Blob read-write token can read and write every plan and the state. It is a full-store secret; rotate it if exposed.

## Data model and retention

`PlanRecord` in `src/records.ts` has:

- `id`, `state` (`pending`, `live`, `removing`, `gone`), `name`, `bytes`.
- `owner`: a keyed hash of the client address used for limits, not the raw address.
- `createdAt`, `expiresAt`, `removedAt`.
- `deleteKeyHash`, never the delete key.
- `hidden`, `claimId`, `claimAt`, `reason` for the removal/takedown path.

The plan HTML is the only object that contains the page. At expiry, author deletion or takedown, the plan blob is deleted. Edge caches may serve a cached copy until the cache TTL (currently one hour) or until the tag purge reaches them.

The record is the tombstone. It keeps the plan name, status, dates, size and technical identifiers after the HTML is gone. **As of 20 October 2026 there is no automatic record TTL; the record is kept indefinitely.** The terms say so. If a retention period is implemented, the terms must be updated before it applies.

The record's content licence survives deletion; the plan HTML licence ends when the HTML is deleted. See `docs/terms-of-use.md`.

## Rendering and safety

Plans are untrusted. The sanitiser uses parse5 for HTML and PostCSS for CSS, with allowlists for elements, attributes, properties and at-rules. It removes plan-authored scripts, links, forms, frames, remote URLs, event handlers and unsafe CSS. The served plan uses a sandboxed CSP with one hash-pinned copy script (no plan-authored scripts; one fixed copy script is injected by the viewer), no remote images and no navigation. The sample route keeps the plan CSP and adds only user-activated top-level navigation for its CTA.

The site pages are React, built by Vite into single files and embedded into the function by `scripts/generate-pages.ts`. The function never reads `dist/` at runtime. The plan template is plain HTML and CSS with no scripts.

## Design system

`tokens.json` is the source of truth for the card and chart values. `scripts/generate-tokens.ts` writes the Tailwind `@theme` and the plan template's `:root`; `scripts/generate-sample.ts` builds the sample from the template's stylesheet and `public/sample/body.html`.

Two card variants ship:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, 14px padding (16px text inset). It is `.box`/`.kpi` in the plan template, `.card` in the component reference and `.plan-card` in React.
- `card-outline`: transparent, a full 1px `line` border, 12px `radius-card`, 15px padding (the same 16px inset). It is `.box.outline`/`.kpi.outline`, `.card--outline` and `.plan-card-outline` respectively.

Headings outside cards use the 16px inset; subheads inside cards use `.eyebrow` so they do not add a second inset. The 6px swatch uses 3px, the bars and Gantt use 4px, and the budget segments keep 2px gaps. `radius-card` lives in the token source because the outline card needs it; the left card stays square.

## Deployment

Vercel deploys `main` when the project is connected to the GitHub repository. `api/index.ts` is the function entry; `vercel.json` sets the LHR1 region and routes requests to it. Vercel runs the function on Node 24; Bun runs local development, tests and builds. `/health` is uncached and reports the build, runtime, commit and configuration flags. The startup purge removes stale cache tags for every plan blob, once per instance.

The optional helper in `scripts/deploy.ts` refuses unless the checked-out branch is `main` and the project plan is Pro. It is stricter than Vercel and is not a runtime boundary; a Hobby project can be deployed with `vercel --prod`. The production branch should stay `main`; a preview must not accept uploads.

`/health` reports the runtime actually in use.

## Security boundaries

- **Plan content:** the sanitiser and the sandboxed plan CSP. No plan-authored scripts; one fixed copy script is injected by the viewer. No links, forms, frames or remote requests.
- **Store:** the Blob token and the private store. The plan-path HMAC protects plan HTML only; on a public store `state.json` and `config/kill.json` stay reachable at their Blob URLs, so use a private store.
- **Delete key:** only its hash is stored; the key is returned once to the uploader.
- **Admin:** `PLANNY_ADMIN_TOKEN` for takedown and reset; rate-limited by the keyed address.
- **Address hash:** `PLANNY_ADDRESS_KEY`; the raw address is not stored in the plan record. The key is stable; rotating it resets all derived addresses and rate limits. If the key is unset, the Blob token is used, so rotating the token has the same effect.
- **Deploy helper:** the optional `scripts/deploy.ts` refuses non-Pro projects and fails closed on unknown plans; previews must not publish. Vercel itself does not enforce the Pro check.
- **Secrets:** the Blob token, address key, Blob path key and admin token. See `SECURITY.md`.

## Failure modes

- **Blob unavailable:** the store adapters throw `StoreUnavailableError` and the app returns the designed 503; it does not serve stale or unauthorised data.
- **Lock busy:** the create-only lock retries; after 200 attempts the request gets a 503.
- **Stale lock:** a lock older than 15 seconds is removed and retried.
- **Cross-instance read lag:** the per-instance sequence cache protects the latest write on that instance; other instances can still see an older state for a moment. Re-read before a dependent write.
- **Orphan plan:** a crash between the plan write and the pending record leaves a plan blob; the sweep and the record lifecycle handle it.
- **Purge failure:** the delete/takedown still removes the plan from the store and marks the record; the cache TTL is the fallback until the tag purge succeeds.
- **Public store leak:** `state.json`/`config/kill.json` are directly readable; use a private store or the state HMAC.
- **Preview publish:** the preview upload check and the production origin check are meant to stop it; verify on every preview.

## Tests and CI

`bun test` covers the sanitiser, the plan state machine, limits and guards, the view path with the per-plan counter, the admin audit, rate limits and resets, error pages and headers, the upload switch, the local SQLite store and its migration, the raw-body boundary, the adversarial sanitiser matrix, the Vercel entry with a fake environment, the deploy helper, the token/sample generators and the React card contract.

The real Blob calls and cache purges need a deployed smoke test; they are not unit-testable without a Vercel project. The CI workflow runs install, typecheck, build and test. The live smoke test checks raw HTML delivery, a cache HIT, 404/410 MISS, a takedown purge, `/health` and `/sample`.

## Known limitations

- A public Blob store exposes `state.json` and `config/kill.json`; use a private store unless the state HMAC is implemented.
- The plan record has no automatic expiry, as the terms state.
- The deployed smoke checks (raw HTML delivery, a cache HIT, 404/410 MISS, a takedown purge, `/sample` and the 320px layout) are manual.
