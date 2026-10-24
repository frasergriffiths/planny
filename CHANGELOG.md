# Changelog

All notable changes to planny are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- One upload can no longer burn minutes of server CPU. parse5 handles attribute
  counts super-linearly, and a probe put 60,000 attributes (937 KB, under the 4 MiB
  cap) on one request against production: 22.5 seconds of wall time, trending to
  about 3.5 minutes at the full cap. A linear scan now bounds attributes
  before the parser runs: 2,048 per tag and 40,000 per document, counted on end tags
  too, because parse5 tokenizes those just as expensively before dropping them.
  Oversized plans get 400 `too_many_attributes` in milliseconds instead — the
  937 KB bomb that took 22.5 s to parse rejects in under 1 ms.
  The document cap sits at 40,000 on measured evidence: a dense 8,000-row table
  (40,000 real attributes) parses in 29 ms, a 42,007-attribute variant is refused
  in 1 ms, and the widest accepted shape so far (38,912 attributes at the per-tag
  boundary) still parses in 94 ms — 20,000 would have refused the dense-table class.
- The counting scan itself had three bypasses, all closed. The scan mirrors the
  parse5 tokenizer state for state: a `>` inside a quoted attribute value is value
  text and no longer ends the tag early; `<!--` inside `title`, `textarea`,
  `style`, `script`, `xmp`, `iframe` and `noscript` interiors is text, not a
  comment, so a real close after it is still reached; and `=` as the first
  character of an attribute name opens that attribute instead of being rebuilt as
  a separator. The content model also tracks the tokenizer through the script
  escape dance, `svg`/`math` foreign content, and the `select` and `frameset`
  zones, and attributes on end tags are walked where the tokenizer walks them —
  so attributes hidden in any of these shapes are counted, and each class was a
  400 at the old boundary where the first cut skipped it.
  A second review round closed three more ways to skip: nested `svg`/`math`
  contexts now open at any depth and only a matching end tag pops through the
  tracked stack, exactly where parse5's own walk-up pop ends; a start tag from
  parse5's break-out list, `</p>` or `</br>`, never empties the context (parse5
  stops at an HTML element or an integration point, so staying in markup mode can
  only over-count); and attributes on end tags inside raw-text interiors — which
  parse5 tokenizes before dropping — are added to the document total instead of
  being thrown away, so a 100-repeat title end-tag bomb (204,700 tokenized
  attributes) is refused in 2 ms at the app boundary and 42,007 realistic
  attributes stay the refusal boundary. A property test generates the
  nested-foreign families and requires that every accepted body mints at most the
  per-tag and document caps in the real parse5 tree.
  A third review round closed the scanner's missing after-attribute-name state:
  after a bare attribute name parse5 treats `=` as that attribute's value
  separator, while each further name segment separated by `/` mints a real
  attribute. The scan used to drop back to before-attribute-name and count the
  second `=` as a new attribute whose unquoted value swallowed the rest of the
  run, so `<v a == x0/x1/…/x99/ ` repeated ~1,000 times scanned as ~2,000 entries
  while the tokenizer processed ~101 per repetition (~103,424), and one ~806 KB
  request burned about 16 seconds and stored its 110 bytes. The state now holds
  whitespace, ends the tag on `>`, opens the value on `=` without a new count,
  and sends any other character to the before-attribute-name state — exactly
  parse5's machine — so both bomb sizes are refused pre-parse in ~1 ms. The
  property test also generates generic `=`/`/` separator soup with unique
  per-segment names.
- The per-address upload gate claims its slot in the same atomic step that checks it.
  Before, the gate only read the counters and the slot was recorded only after a
  successful publish, so uploads sent in parallel could share one spacing window and
  race past the daily and monthly caps. A failing upload now returns its claimed slot;
  refusals still leave the counters untouched.

### Added

- Every published plan ends with one restrained viewer line, "Made with Planny",
  linking to https://use-planny.vercel.app. It is added after the sanitiser and never
  stored with the plan. The line paints an opaque, contrast-safe band and resists plan
  CSS on a best-effort basis; a plan stylesheet shares the document and can still hide or
  cover it.
- 404 and 410 plan pages invite the reader to publish their own plan.
- `/sample` carries the same footer, so the demo page advertises planny too.
- `PLANNY_ATTRIBUTION` (default `on`); setting it to `off` removes both lines for
  self-hosters.
- A paste-and-publish box on the home page. Paste one HTML page, click **Get a link**,
  get a URL and a delete key. It posts to the new `POST /demo/plans`, which runs the same
  sanitiser and 4 MiB cap, fixes the life at 24 hours, and charges its own monthly counter
  (`PLANNY_DEMO_MONTHLY_UPLOADS`, default 500) instead of `PLANNY_MONTHLY_UPLOADS`. A
  public demo cannot spend the site-wide upload budget, and an exhausted demo allowance
  leaves the API working.
- `@vercel/analytics` on the home, 404, 410 and 503 pages.
- A `ref` parameter on every outbound link: `?ref=plan` from a plan footer, `sample` from
  the sample, `missing`/`expired`/`deleted`/`takedown` from the plan error pages, and
  `site` from the product links. Analytics can tell a plan-driven visit from a direct one.
- `mcp/`, an MCP server wrapping the existing HTTP API: `publish_plan` and `delete_plan`.
  It has no read or list tool because the API has no collection or metadata route. Includes
  a README with Claude Code and Cursor config, and prepared (unsubmitted) manifests for
  Smithery, Glama, PulseMCP and mcp.so.

### Changed

- The plan sandbox adds `allow-top-navigation-by-user-activation`, so the viewer's
  footer link works without scripts, fetches or any other sandbox permission.
- The site CSP now allows `'self'` in `script-src` and adds `connect-src 'self'`, because
  the analytics script is served from the same origin and the demo box posts with `fetch`.
  No third-party origin is allowed.
- The skill description now leads with publish, share and link so it is findable when
  someone searches skills.sh for a plan or a report.

## 1.2.0 — 2026-10-20

### Changed

- The plan template and component library read as a compact editorial layout:
  a centred 1240px page, a balanced clamp-based type scale, four KPI cards that
  fall to a clean 2x2 on phones, tables and the Gantt scroll inside
  `.table-wrap` / `.gantt-wrap`, and charts moved out of stretched SVG into
  quiet chart cards whose text stays 11-12px at 390, 768 and 1440px.

### Added

- The Planny agent skill is published on skills.sh and installable with
  `npx skills add frasergriffiths/planny --skill planny`.
- The home page has an agent-skill install section with a copyable command,
  supported-agent list, and links to skills.sh and the skill source.
- The favicon set has a dot for 16/32/48px and the `● planny` wordmark for the
  180/192/512px icons.
- README and docs cover the skill, the option to point it at a self-hosted
  instance, and the difference between the required Blob token and the optional
  operator settings.

### Changed

- The canonical origin is `https://use-planny.vercel.app`; links, SEO metadata,
  `security.txt`, docs and the skill default use it.
- Production uses a private Vercel Blob store (`BLOB_ACCESS=private`). The old
  public store is no longer used by the app.
- The canonical terms document lives at `docs/terms-of-use.md` on GitHub.
  `/terms-of-use` returns a 301 there and the footer links to it directly.
- Skill scripts run on Node 22+ as well as Bun; the skill no longer requires Bun
  for a normal `npx skills` install.
- The optional deploy helper is documented as stricter than Vercel: it refuses
  non-Pro projects, while a manual `vercel --prod` deploy remains possible.

### Removed

- The hosted terms page and its React route.

## 1.1.0 — 2026-10-20

### Added

- Privacy notice, acceptable-use policy and Contributor Covenant code of conduct.
- Issue templates, a pull-request template and a security contact route.
- Dependabot configuration for Bun and GitHub Actions.
- `security.txt` for vulnerability reports.
- Self-hosting guide and operator runbook.
- Package metadata: MIT licence, repository, homepage and issue tracker.

### Changed

- The public terms no longer describe the operator credential; they say only that a
  plan can be removed.
- The takedown contact is a monitored inbox.
- The README documents the runtime Vercel actually uses (Node 24) while Bun remains
  the local, test and build runtime.
- The README front door links the legal, security and community documents.

### Security

- The security documentation describes the Blob token's full-store access and
  recommends a private store, or a state HMAC, when the store is public.
- The plan CSP, sanitiser allowlists, hashed delete keys and keyed address hash are
  unchanged.
