# Security

planny stores and serves untrusted HTML. The important boundaries are the plan sanitiser, the CSP, the delete key, the Blob token and the address hash.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue with a working exploit, a leaked token or a plan that contains personal data.

Include the route or file, the smallest reproduction you can make, and whether the issue exposes a plan, a token or the store. If you are unsure whether something is a vulnerability, report it privately anyway.

## What is in scope

- The sanitiser and the plan CSP, including any way to run script, load a remote resource, navigate the page or escape the sandbox.
- The upload, view, delete and takedown paths, including key comparison, expiry and cache purging.
- The Blob state lock and the record lifecycle, including a delete that could revive or hide another plan.
- The address hash and the rate and storage guards.
- The deploy guard and any path that could publish a preview or a non-production build.

## What is not in scope

- A plan's content being public to anyone who has the link. That is the product.
- Denial of service from a very large number of requests that stays within the documented limits; report a bypass of the limits instead.
- Missing hardening on a local development server that is bound to `127.0.0.1`.

## Handling secrets

`BLOB_READ_WRITE_TOKEN`, `PLANNY_ADDRESS_KEY`, `PLANNY_BLOB_KEY_1` and `PLANNY_ADMIN_TOKEN` are secrets. They belong in the Vercel environment, never in the repository, a plan, a screenshot or a log line. If a token is exposed, rotate it before doing anything else. A public Blob store token can read and write the whole store.

The address key is stable: rotating it changes every derived address and resets the rate limits. The Blob key is stable too: rotating it changes the public plan paths and makes existing links fail. Treat both as long-lived credentials.
