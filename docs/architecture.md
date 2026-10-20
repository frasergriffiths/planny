# Architecture

planny is a single TypeScript service on Bun. It accepts one HTML file, sanitises it, stores it in Vercel Blob, and serves it at an unguessable link until it expires or is deleted.

## Request flow

```text
POST /plans
  -> rate and storage guards
  -> read the raw body (4 MiB cap)
  -> sanitise: parse5 tree, PostCSS CSS, allowlists
  -> write plans/<uuid>-<hmac>.html to Blob
  -> write the pending record to the state blob
  -> return url, expiresAt and deleteKey

GET /p/<uuid>
  -> read the record from the state blob
  -> pending, missing, expired, deleted or taken down -> 404 or 410
  -> read the plan HTML from Blob
  -> return it with the plan CSP and a cache tag

DELETE /p/<uuid>
  -> compare the hashed delete key
  -> remove the plan blob
  -> mark the record deleted and purge the cache tag
```

`HEAD` follows the view path and returns the same headers without a body. `/p/<uuid>/raw` redirects to `/p/<uuid>`.

## Storage

There is one store: Vercel Blob. It holds:

- `plans/<uuid>-<hmac>.html`: the plan HTML.
- `state.json`: records, counters, rate windows and the small amount of control state.
- `config/kill.json`: the upload switch.

`src/stores/blob.ts` adapts the Blob API to a small Redis-like interface. A single `state.json` keeps the prototype simple, but it is the main scalability and consistency trade-off. Writes take a create-only lock and use a per-instance sequence cache so a read that lags a write does not lose the latest record. Blob reads can still lag across instances, so do not delete a plan immediately after publishing another one without re-reading the state. The long-term shape is one record per plan plus a separate index, which removes the read-modify-write window.

## Rendering and safety

Plans are untrusted. The sanitiser uses parse5 for HTML and PostCSS for CSS, with allowlists for elements, attributes, properties and at-rules. It removes scripts, links, forms, frames, remote URLs, event handlers and unsafe CSS. The served plan uses a sandboxed CSP with no script source, no remote images and no navigation. The sample route keeps the plan CSP and adds only user-activated top-level navigation for its CTA.

The site pages are React, built by Vite into single files and embedded into the function by `scripts/generate-pages.ts`. The function never reads `dist/` at runtime.

## Design system

`tokens.json` is the source of truth for the card and chart values. `scripts/generate-tokens.ts` writes the Tailwind `@theme`, the template `:root`, and the card padding derived from `inset-card - border-card`. `scripts/generate-sample.ts` builds the sample from the template's stylesheet and `public/sample/body.html`, so the sample cannot drift from the template.

There are two card variants:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, 16px text inset. Used for KPIs, budget and confidence.
- `card-outline`: transparent, full 1px `line` border, 12px radius. Used for step cards and secondary sections.

## Deployment

Vercel builds `main`. `api/index.ts` is the function entry; `vercel.json` sets the Bun runtime and the LHR1 region. `/health` is uncached and reports the commit, runtime and configuration flags. The startup purge removes stale cache tags for every plan blob, once per instance.

The deploy guard in `scripts/deploy.ts` refuses to publish unless the project plan is Pro. The production branch should stay `main`; a preview must not accept uploads.

## Tests

`bun test` covers the sanitiser, the plan state machine, limits and guards, the local store and its migration, the Vercel entry with a fake environment, the deploy guard, the token and sample generators, and the React card contract. The real Blob calls and cache purges need a deployed smoke test; they are not unit-testable without a Vercel project.
