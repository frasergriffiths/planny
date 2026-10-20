# Security

planny stores and serves untrusted HTML. The important boundaries are the plan sanitiser, the plan CSP, the delete key, the Blob token, the admin token and the keyed address hash.

## Reporting a vulnerability

Email `frasergriffithsisme@icloud.com` with `planny security` in the subject. Include the route or file, the smallest reproduction you can make, and whether the issue exposes a plan, a token or the store. Do not open a public issue with a working exploit, a leaked token or a plan that contains personal data. If you are unsure whether something is a vulnerability, report it privately anyway.

We will acknowledge the report as soon as we can, agree a disclosure timeline with you, and credit you if you want. Our target is to acknowledge within 72 hours and give an initial assessment within 7 days. Please give us a reasonable chance to fix the issue before publishing it. There is no bug bounty. A machine-readable contact is at `/.well-known/security.txt`.

## Takedowns

For a takedown request, email `frasergriffithsisme@icloud.com`. Include the plan URL, what is wrong, and a way to verify the request. Mark security reports `planny security` in the subject.

The operator may remove a plan at any time. The plan HTML is removed from the store; the record with the plan name, status and dates remains as the terms describe. A takedown is not a promise that every edge cache has already expired; the cache tag is purged and the TTL is the fallback.

## Supported versions

The hosted service runs the latest `main`. There are no maintained older release branches. For a self-hosted copy, update to the latest commit before reporting a deployment-specific issue.

## What is in scope

- The sanitiser and the plan CSP, including any way to run script, load a remote resource, navigate the page or escape the sandbox.
- The upload, view, delete and takedown paths, including key comparison, expiry and cache purging.
- The Blob state lock and the record lifecycle, including a delete that could revive or hide another plan.
- The address hash and the rate and storage guards.
- The deploy guard and any path that could publish a preview or a non-production build.
- A public Blob store exposing `state.json`, `config/kill.json` or another object that bypasses expiry, deletion or a takedown.

## What is not in scope

- A plan's content being public to anyone who has the link. That is the product.
- Denial of service from a very large number of requests that stays within the documented limits; report a bypass of the limits instead.
- Missing hardening on a local development server that is bound to `127.0.0.1`.
- A plan that contains secrets or personal data the uploader chose to publish.
- The behaviour of a fork or a modified deployment that does not match this repository.

## Handling secrets

`BLOB_READ_WRITE_TOKEN`, `PLANNY_ADDRESS_KEY`, `PLANNY_BLOB_KEY_1` and `PLANNY_ADMIN_TOKEN` are secrets. They belong in the Vercel environment, never in the repository, a plan, a screenshot or a log line. If a token is exposed, rotate it before doing anything else. A public Blob store token can read and write the whole store.

The address key is stable: rotating it changes every derived address and resets the rate limits. The Blob key is stable too: rotating it changes the public plan paths and makes existing links fail. Treat both as long-lived credentials.

`BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` are connection metadata. Do not paste them into a plan or a public issue.

A public Vercel Blob store exposes every object at its Blob URL. The plan HMAC protects plan HTML names; it does not protect `state.json` or `config/kill.json`. Use a private store, or add the state HMAC before enabling a public store.

## Safe harbour

We will not pursue legal action for good-faith security research that stays within your own plans and accounts, avoids privacy violations, does not degrade the service and gives us a reasonable time to fix the issue before disclosure. Do not access, modify or retain another person's plan or data.

## Plan content and the terms

The plan HTML is deleted at expiry, author deletion or operator takedown. The service keeps a record with the plan name, status, creation/expiry/deletion/takedown dates and related identifiers. The record currently has no automatic expiry and is kept indefinitely; the terms say the record is kept indefinitely. See `docs/terms-of-use.md`.

Plans are public by link. Do not put secrets or personal data in a plan. The sample in `public/sample/` is fictional.
