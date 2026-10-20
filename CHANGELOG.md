# Changelog

All notable changes to planny are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- The takedown contact is a monitored personal inbox instead of a domain that does
  not resolve.
- The README documents the runtime Vercel actually uses (Node 24) while Bun remains
  the local, test and build runtime.
- The README front door links the legal, security and community documents.

### Security

- The launch checklist treats a public Blob store and the exposed Blob token as
  release blockers. Do not publish the repository until both are resolved.
- The plan CSP, sanitiser allowlists, hashed delete keys and keyed address hash are
  unchanged.
