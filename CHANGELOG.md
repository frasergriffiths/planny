# Changelog

All notable changes to planny are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

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

### Changed

- The plan sandbox adds `allow-top-navigation-by-user-activation`, so the viewer's
  footer link works without scripts, fetches or any other sandbox permission.

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
