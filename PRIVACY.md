# Privacy notice

**Effective 20 October 2026. Last updated 20 October 2026.**

planny is operated by Fraser Griffiths ("we", "us", "our"). This notice explains what
we collect when you publish or read a plan, why we use it, and what rights you have.
It covers the hosted service at `planny-pink.vercel.app`. If you self-host planny,
you are the controller for your instance and this notice does not apply to it.

This is a plain-English notice, not legal advice. Have it reviewed before relying on
it for a commercial launch.

## What we collect

| Data | When | Why |
| --- | --- | --- |
| Plan HTML and plan name | When a plan is published | To store and serve the plan at its link |
| Plan size, creation, expiry, deletion and takedown dates | When a plan is published or changed | To enforce limits, expiry and deletion |
| A keyed hash of the request address | On uploads, views, deletes and operator calls | To enforce rate limits, storage limits and pauses. We do not store the raw address in the plan record |
| A hash of the delete key | When a plan is published | To authorise deletion without storing the key itself |
| Technical identifiers such as the plan ID and claim ID | During publishing and deletion | To keep the record consistent and recover from interrupted writes |
| Request logs | When you use the service | Vercel, our hosting provider, processes standard request logs such as IP address, user agent and timestamp under its own terms |

We do not operate accounts, we do not set advertising cookies, and we do not sell
plan content or address data.

## Public links

A plan link is public to anyone who has it. We do not publish an index of plans, but
we cannot stop someone sharing a link, and a search engine may index a plan if it
finds the link. Do not put secrets, passwords, private keys, personal data or
confidential information in a plan.

## Why we use it

We use the data to:

- publish, store, serve and delete plans;
- enforce the limits, rate limits and pauses described in the README;
- investigate abuse, security reports and takedown requests;
- keep the service available and fix faults; and
- meet legal and accounting obligations.

Our lawful bases are:

- **Contract or steps before a contract** for publishing and serving a plan you
  asked us to publish;
- **Legitimate interests** for security, abuse prevention, rate limiting, service
  reliability and keeping a minimal record after a plan is gone;
- **Legal obligation** where we must keep or disclose something; and
- **Consent** only where we ask for it separately. We do not rely on consent for
  the core service.

## Who receives it

- **Vercel** hosts the function, the Blob store, the edge cache and request logs.
- **Our email provider** processes takedown and legal correspondence sent to the
  contact below.
- **Professional advisers, auditors or authorities** where the law requires it or
  where needed to establish or defend a legal claim.

We do not sell personal data. Some providers may process data outside the UK; where
they do, we rely on their contractual safeguards and UK adequacy or transfer
mechanisms.

## How long we keep it

- **Plan HTML** is deleted when the plan expires, is deleted by its uploader, or is
  taken down. Cached copies may remain at the edge until the cache expires (currently
  up to one hour) or is purged.
- **The plan record** (name, status, dates, size, keyed address hash and hashed delete
  key) is kept after the HTML is gone. As of the effective date it has no automatic
  expiry and is kept indefinitely. We will update this notice before applying a
  different retention period. The record may be kept for legal, security,
  abuse-prevention and operational reasons.
- **Request logs** are retained by Vercel under its terms and its configured retention.

## Your rights

You have the right to ask for access to your personal data, correction, erasure,
restriction, objection to processing based on legitimate interests, and portability
where it applies. You can also withdraw consent where we rely on it.

Email `frasergriffithsisme@icloud.com` with the request and enough information for us
to verify it. We will respond within one month, extended by up to two months where a
request is complex. These rights are not absolute; for example, we may need to keep a
record to comply with the law or defend a claim.

If you are unhappy with our response, you can complain to the UK Information
Commissioner's Office at `ico.org.uk` or by post to the ICO, Wycliffe House, Water
Lane, Wilmslow, Cheshire SK9 5AF. We would prefer the chance to resolve it first.

## Security

The link is the only read key, so treat it as public. Delete keys are returned once
and only a hash is stored. The operator can remove a plan. We use a keyed address
hash for limits, a restrictive content security policy for plans, and a sanitiser that
removes scripts, links, forms, frames and remote resources. No service is completely
secure; report a vulnerability through the private route in `SECURITY.md`.

## Changes

We may update this notice. The current version will be in the repository and on the
service, with the effective date. If a change is material, we will make that clear.

## Contact

Privacy questions and requests: `frasergriffithsisme@icloud.com`.

Takedowns and legal notices: the same address. Security vulnerabilities: use GitHub's
private vulnerability reporting as described in `SECURITY.md`, not this inbox.
