<!-- Copy for the /terms-of-use page. The React route is wired separately. -->
# Terms of use

**Effective 20 October 2026. Last updated 20 October 2026.**

planny is operated by Fraser Griffiths ("we", "us", "our"). The service lets you publish an HTML plan and gives you a link. By uploading a plan or using the service, you agree to these terms. If you do not agree, do not use the service.

## 1. The service

planny accepts one HTML file, sanitises it, stores it, and serves it at a link. The link is public to anyone who has it. There are no accounts, no passwords and no private plans. A plan has a lifetime; it expires, can be deleted by its uploader with the delete key, or can be removed by the operator.

The service is provided as-is. It is not a backup service and it is not a confidential storage service. Keep your own copy of anything you need.

## 2. Your content and the licence you give us

You keep ownership of the plan and its contents.

By publishing a plan, you grant Fraser Griffiths a non-exclusive, worldwide, royalty-free licence to store, copy, transmit, display, serve, cache and make technical copies of the plan HTML and its contents for the purpose of operating, securing and improving the service, and to authorise our hosting providers to do the same.

The licence to the plan HTML lasts while the plan is live. When the plan HTML is deleted at expiry, author deletion or takedown, that licence ends for the HTML, except for cached copies that may remain until the cache expires or is purged.

After the HTML is deleted, we keep a record containing the plan name, status, creation, expiry, deletion and takedown dates, size and technical identifiers (including a keyed address hash and a hashed delete key). You grant us a non-exclusive, worldwide, royalty-free licence to keep, use and display that record for the retention period, including after the HTML is gone. The record does not contain the plan HTML.

You confirm that you have the rights and consents needed to publish the plan and to grant this licence, and that the plan does not infringe anyone else's rights, contain other people's personal data without permission, or break the law.

## 3. Public links, no accounts

Anyone with the link can read the plan. We do not list plans or publish an index, but we cannot stop someone sharing a link, and a search engine may index a plan if it finds the link. Do not put secrets, passwords, private keys, personal data or confidential information in a plan.

The delete key is returned when you publish. Keep it secret. Only a hash of the delete key is stored; we cannot recover the key for you. Anyone with the delete key can delete the plan. The operator can remove a plan with the admin token.

## 4. Limits and availability

The service has limits, including a 4 MiB plan limit, a plan lifetime, monthly read and upload limits, and per-address rate limits. The current defaults are in the repository README and `.env.example`. We may pause uploads or new views when a guard is reached; deletes, author takedowns and admin resets keep working.

We do not promise uninterrupted availability, a particular speed, or that a plan will remain available for its full lifetime. We may change, suspend or stop the service, in whole or in part.

## 5. Address data and rate limits

We use a keyed hash of the request address to enforce rate limits and pauses. The plan record stores that keyed hash, not the raw address. Our hosting provider may process request logs under its own terms. We do not sell plan content or address data, and we do not use advertising cookies.

The keyed address hash is not a user account; it is a technical anti-abuse measure. Rotating the key resets the derived addresses and the limits.

## 6. Acceptable use

Do not use planny to publish or distribute:

- illegal content, malware, phishing, fraud or instructions for serious harm;
- child sexual abuse material or content that exploits or endangers a child;
- another person's personal data or confidential information without permission;
- harassment, threats, hate or content that violates someone's privacy or rights;
- spam, deceptive links, or content designed to evade the rate limits, the sanitiser or the plan CSP;
- content that interferes with the service or another person's use of it.

We may remove any plan, with or without notice, if we believe it breaks these terms, the law or the security of the service. We are not obliged to monitor every plan.

## 7. Takedowns

If you believe a plan should be removed, use the contact in section 12. Include the plan URL, what is wrong, and enough information for us to verify the request. We may remove the plan and keep the record described in section 2. A takedown does not guarantee that every edge cache has already expired; we purge the plan's cache tag and the cache TTL is the fallback.

## 8. Retention and deletion

The plan HTML is deleted from the Blob store when it expires, is deleted by its uploader, or is taken down. Cached copies may remain at the edge until the cache expires (currently up to one hour) or is purged.

The record described in section 2 is kept after the HTML is gone. **As of the effective date, the record has no automatic expiry and is kept indefinitely.** We will update these terms before applying a different retention period. The record may be kept for legal, security, abuse-prevention and operational reasons.

## 9. Privacy

We do not operate user accounts. We process the plan content, the plan name, the record metadata, the keyed address hash and the request logs needed to run and secure the service. The plan content is public by link. Our hosting and storage providers process data on our behalf. We do not sell personal data.

Do not include personal data in a plan unless you have the right to publish it. The record keeps the plan name and dates after the HTML is gone; if the name contains personal data, that name remains in the record.

## 10. Disclaimers and liability

To the maximum extent permitted by law, the service is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, security or non-infringement. We do not warrant that a plan will be available, complete, private or free of harmful content.

To the maximum extent permitted by law, we are not liable for indirect, incidental, special or consequential loss, or for loss of profits, data, goodwill or opportunity, arising from the service or a plan. Our total liability for all claims relating to the service is limited to £100. Nothing in these terms limits liability for death or personal injury caused by negligence, fraud, or any liability that cannot be limited by law.

You are responsible for your plan and for any claim arising from it. You will indemnify us against third-party claims, losses and costs arising from your plan, your breach of these terms or your misuse of the service, to the extent permitted by law.

## 11. Changes

We may update these terms. The current version will be at `/terms-of-use`, with the effective date. Continued use after an update means you accept the updated terms. If a change is material, we will make that clear on the page.

If any provision is found unenforceable, the rest remains in force. These terms and the documents they link to are the entire agreement about the service.

<a id="contact"></a>
## 12. Contact

For takedowns, legal notices and terms questions: `takedown@planny.run`.

For security vulnerabilities, please use GitHub's private vulnerability reporting as described in `SECURITY.md`, not the takedown contact.

These terms are governed by the laws of England and Wales, and the courts of England and Wales have exclusive jurisdiction, except where consumer law gives you a different right.
