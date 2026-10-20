# Contributing

Thanks for taking a look. planny is a small service: one HTML file in, one link out. Keep changes focused and leave the security boundaries alone unless the change is about them.

## Setup

```sh
bun install
bun run test
bun run dev
```

The local app runs at `http://127.0.0.1:4317` and keeps its data in `~/Library/Application Support/planny-local`. Copy `.env.example` to `.env.local` only when you need to override a local setting. Never commit real values.

## The checks

```sh
bun run typecheck
bun run test
bun run build
```

`bun run test` runs the type check, verifies that the generated tokens and sample are in sync, runs the test suite, and checks the error registry. The suite uses the local store; the real Blob calls are covered by Vercel smoke tests after a deploy. A lock test is occasionally slow under load; rerun it before changing anything around the lock.

## Cards and tokens

`tokens.json` is the source of truth for the card and chart values. Do not edit the generated `/* TOKENS */` block in `skills/planny/template.html`, the generated sample, or the `@theme` block in `web/src/index.css` by hand. Run:

```sh
bun run tokens    # rewrite the generated token blocks
bun run sample    # regenerate public/sample/index.html from the template and sample body
```

There are two card variants:

- `card-left`: transparent, no full border, no radius, a 2px accent left rule, and a 16px text inset. The KPI, budget and confidence cards use this.
- `card-outline`: transparent, a full 1px `line` border, and the 12px `radius-card`. The home step cards and secondary plan sections use this.

Both use `box-sizing: border-box`. The left card's border and padding add up to `inset-card`; headings outside cards use the same inset. Subheads inside cards use `.eyebrow` so they do not add a second inset.

## Style

- TypeScript strict mode, no `any`, no non-null assertions unless the invariant is local and obvious.
- Zod at every input edge. Keep errors in `src/error-codes.ts` and run `bun run scripts/generate-skill-errors.ts` after changing them.
- Prefer a small pure function and a test over a new abstraction.
- The browser-facing pages are React in `web/`; the plan template is plain HTML and CSS with no scripts.
- Keep the plan sanitiser conservative. If you add an allowed tag or attribute, add a hostile fixture too.

## Security and privacy

Plans are public to anyone with the link. Do not put secrets or personal data in a plan, a test fixture, a screenshot or a commit. Report a vulnerability through GitHub's private security advisory flow rather than a public issue. See `SECURITY.md`.

## Pull requests

Small, single-purpose PRs are easiest to review. Include what changed, why, the commands you ran, and any behaviour that is deliberately left out. If a change affects the Blob store, the sanitiser, the delete path or the deploy guard, say so explicitly.
