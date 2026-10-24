# Operator runbook

This is the short version for the person running the hosted instance. It assumes the
Vercel project is linked and the production environment is set. Never paste a token,
a plan deletion key or a raw request address into an issue, a plan or a chat.

## Takedown

1. Check the report: the plan URL, what is wrong and enough information to verify it.
2. Confirm the plan ID from the URL: `/p/<uuid>`.
3. Remove it:

   ```sh
   PLANNY_BUILD=vercel bun run admin takedown <uuid>
   ```

   The command reads the production environment after `vercel env pull`, removes the
   plan blob, marks the record gone and purges the cache tag.
4. Check the link returns 410, then check a second time after the cache TTL. A purge
   can fail; the one-hour TTL is the fallback.
5. Reply to the reporter. Do not promise that every edge cache has already expired.
6. Keep the record as the terms describe. Do not edit the plan name in the record.

If the plan is still visible after the TTL, treat it as an incident and escalate.

## Rotate a credential

Rotate immediately if a token appears in a chat, a commit, a log, a screenshot or a
plan.

1. Create the replacement in the Vercel dashboard or with `vercel env`.
2. Update the production environment. Keep preview and development values separate.
3. Redeploy so the function picks up the new value.
4. Revoke the old token at the provider.
5. Check `/health` reports the same presence flags and `configured: true`.
6. If `PLANNY_ADDRESS_KEY` changed, expect all rate limits and pauses to reset. If
   `PLANNY_BLOB_KEY_1` changed, expect existing public plan links to fail.

The Blob token can read and write the whole store. A public store token also exposes
objects directly. Do not create one.

## Store outage or 503

1. `GET /health` is uncached. Read `purge`, `configured` and `error`.
2. Check the Vercel status page and the Blob store.
3. If the store is unavailable, the app returns a designed 503 rather than serving
   stale or unauthorised data. Do not switch to a public store as a workaround.
4. If a guard is paused, the paused page names the guard and the reset date. Use the
   admin reset only after the cause is understood:

   ```sh
   PLANNY_BUILD=vercel bun run admin reset reads
   PLANNY_BUILD=vercel bun run admin reset bytes
   PLANNY_BUILD=vercel bun run admin reset uploads
   PLANNY_BUILD=vercel bun run admin reset demo
   PLANNY_BUILD=vercel bun run admin reset all
   ```

   The demo box has its own monthly quota. `reset uploads` and `reset all` do not
   clear it; use `reset demo` when the demo allowance, not the site-wide upload
   budget, is exhausted. The smaller per-address demo caps
   (`PLANNY_DEMO_UPLOADS_PER_ADDRESS_DAY` and `..._MONTH`) are not cleared by
   `reset demo`; their day and month keys expire with their windows.

5. To stop uploads without stopping reads (the switch is written to
   `config/kill.json`):

   ```sh
   PLANNY_BUILD=vercel bun run admin uploads off
   PLANNY_BUILD=vercel bun run admin uploads status
   PLANNY_BUILD=vercel bun run admin uploads on
   ```

## Suspected vulnerability

1. Keep the report in the security inbox and do not discuss a working exploit in a
   public issue.
2. Acknowledge within 72 hours. Agree a disclosure timeline; credit the reporter if
   they want it.
3. Reproduce in a local instance. Treat the sanitiser, the plan CSP, the delete path,
   the Blob store, the preview upload block and the deploy helper as the highest severity.
4. Fix, add a regression test, deploy, then publish an advisory if needed.
5. If a token may be exposed, rotate it before anything else.

There is no bug bounty. Safe harbour and scope are in `SECURITY.md`.

## Rollback

Vercel keeps previous deployments. Roll back to the last known good deployment from
the dashboard, then confirm `/health` and a publish/view/delete cycle. The Blob store
is not versioned with the deployment; a rollback does not undo a plan deletion or a
takedown.

## Routine checks

Weekly:

- `/health` is 200, `configured: true`, `purge: ok`, `access: private`, `accessConfigured: true`.
- The live commit in `/health` matches the intended `main` commit.
- The Blob store is still private in the Vercel dashboard (`/health` echoes the env value only).
- No new secret scanning alert, Dependabot alert or failed deployment.
- The takedown inbox and security advisories have no unanswered report.
- Storage and read usage are inside the limits in the README.

Monthly:

- Review the limits against actual traffic.
- Check that the latest `main` is deployed and the previous deployment is still available for rollback in Vercel.
- Re-read the retention wording against what the store actually does.
