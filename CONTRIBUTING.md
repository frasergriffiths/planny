# Contributing

Thanks for taking a look. planny is a small service: one HTML file in, one link out. Keep changes focused and leave the security boundaries alone unless the change is about them.

## Setup

```sh
bun install
cp .env.example .env.local   # only if you need local overrides
bun run test
bun run dev                  # http://127.0.0.1:4317
```

The local app keeps its data in `~/Library/Application Support/planny-local`. Never commit real values from `.env.local`, a plan, a screenshot or a test fixture. Plans are public to anyone with the link; use the fictional sample for examples.

## The checks

```sh
bun run typecheck
bun run test
bun run build
```

`bun run test` runs the type check, verifies that the generated tokens and sample are in sync, runs the test suite, and checks the error registry. The suite uses the local store; the real Blob calls and cache purges need a deployed smoke test. The CI workflow runs the same checks with `bun install --frozen-lockfile`.

`bun test` alone runs the suite without the generated-file checks. A lock test can be slow under load; rerun it before changing anything around the lock.

## Cards and tokens

`tokens.json` is the source of truth for the card and chart values. Do not edit the generated `/* TOKENS */` block in `skills/planny/template.html`, the generated sample, or the `@theme` block in `web/src/index.css` by hand. Run:

```sh
bun run tokens    # rewrite the generated token blocks
bun run sample    # regenerate public/sample/index.html from the template and sample body
```

There are two card variants:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, 14px padding (16px text inset). The KPI, budget and confidence cards use this.
- `card-outline`: transparent, a full 1px `line` border, 12px `radius-card`, 15px padding (the same 16px inset). The home step cards and secondary plan sections use this.

The plan template exposes them as `.box`/`.box.outline` and `.kpi`/`.kpi.outline`; the component reference uses `.card`/`.card--outline`; React uses `.plan-card`/`.plan-card-outline`. Both use `box-sizing: border-box`. Headings outside cards use the same inset; subheads inside cards use `.eyebrow` so they do not double it.

## Generated files and errors

`scripts/generate-tokens.ts` writes the token blocks, `scripts/generate-sample.ts` builds the sample, and `scripts/generate-skill-errors.ts` writes `skills/planny/reference/errors.md` from `src/error-codes.ts`. Change the source, then run the generator. Do not hand-edit the generated output.

If you add an error code, add it to `src/error-codes.ts`, run the errors generator, and check the skill reference. If you add a sanitiser allowance, add a hostile fixture too.

## Style

- TypeScript strict mode, no `any`, no non-null assertions unless the invariant is local and obvious.
- Zod at every input edge.
- Prefer a small pure function and a test over a new abstraction.
- The browser-facing pages are React in `web/`; the plan template is plain HTML and CSS with no scripts.
- Keep the plan sanitiser conservative. The plan CSP, the delete key, the Blob token and the address hash are the security boundaries.
- Update the README, `docs/architecture.md` or `docs/terms-of-use.md` when behaviour or the service terms change.

## Documentation

The user-facing terms copy is `docs/terms-of-use.md`; the React route is wired separately. The terms must keep the honest retention wording: the plan HTML is deleted at expiry, deletion or takedown, while the name/status/date record currently has no automatic expiry. The takedown contact is a single placeholder until Fraser supplies the address; do not invent an address or add a second placeholder.

## Security, privacy and licence

Plans are public to anyone with the link. Do not put secrets or personal data in a plan, a test fixture, a screenshot or a commit. Report a vulnerability through GitHub's private security advisory flow rather than a public issue; see `SECURITY.md`. Takedown requests use the contact on the terms page.

By contributing, you agree that your contribution is licensed under the MIT licence in `LICENSE`. There is no separate CLA.

## Pull requests

Small, single-purpose PRs are easiest to review. Include what changed, why, the commands you ran, and any behaviour that is deliberately left out. If a change affects the Blob store, the sanitiser, the delete path, the terms or the deploy guard, say so explicitly.

Before opening a PR, run `bun run test` and `bun run build`. Do not commit generated build output, local data, `.env` files or real plan content.
