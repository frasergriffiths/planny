import type { ReactNode } from 'react';

const CONTACT = 'frasergriffithsisme@icloud.com';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Terms() {
  return (
    <article className="mx-auto max-w-3xl py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">Terms of use</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">Terms of use</h1>
      <p className="mt-4 font-mono text-xs text-zinc-600">Effective 20 October 2026. Last updated 20 October 2026.</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-zinc-400">
        <p>
          planny is operated by Fraser Griffiths. It publishes one HTML plan at a link. By uploading a plan or using
          the service, you agree to these terms. If you do not agree, do not use the service.
        </p>

        <Section title="The service">
          <p>
            planny sanitises and stores an HTML plan and serves it at a link. The link is public to anyone who has
            it. There are no accounts, no passwords and no private plans. A plan has a lifetime and can expire, be
            deleted by its uploader with the delete key, or be removed by the operator.
          </p>
          <p>
            The service is provided as-is. It is not a backup service and it is not confidential storage. Keep your own
            copy of anything you need.
          </p>
        </Section>

        <Section title="Your content and the licence you give us">
          <p>
            You keep ownership of the plan and its contents. By publishing a plan, you grant Fraser Griffiths a
            non-exclusive, worldwide, royalty-free licence to store, copy, transmit, display, serve, cache and make
            technical copies of the plan HTML and its contents to operate, secure and improve the service, and to
            authorise our hosting providers to do the same.
          </p>
          <p>
            The licence to the plan HTML lasts while the plan is live. When the HTML is deleted at expiry, author
            deletion or takedown, that licence ends for the HTML, except for cached copies that may remain until the
            cache expires or is purged.
          </p>
          <p>
            After the HTML is deleted, we keep a record with the plan name, status, creation, expiry, deletion and
            takedown dates, size and technical identifiers, including a keyed address hash and a hashed delete key.
            You grant us a licence to keep and use that record for as long as it is in our records, including after
            the HTML is gone. The record does not contain the plan HTML.
          </p>
          <p>
            You confirm that you have the rights and consents needed to publish the plan and grant this licence, and
            that the plan does not infringe anyone else&apos;s rights, contain other people&apos;s personal data without
            permission, or break the law.
          </p>
        </Section>

        <Section title="Public links, no accounts">
          <p>
            Anyone with the link can read the plan. We do not list plans or publish an index, but we cannot stop
            someone sharing a link, and a search engine may index a plan if it finds the link. Do not put secrets,
            passwords, private keys, personal data or confidential information in a plan.
          </p>
          <p>
            The delete key is returned when you publish. Keep it secret. Only a hash of the delete key is stored; we
            cannot recover the key for you. Anyone with the delete key can delete the plan.
          </p>
        </Section>

        <Section title="Limits and address data">
          <p>
            The service has a 4 MiB plan limit, plan lifetimes, monthly read and upload limits, and per-address rate
            limits. We may pause uploads or new views when a guard is reached; deletions and operator takedowns keep
            working.
          </p>
          <p>
            We use a keyed hash of the request address to enforce rate limits and pauses. The plan record stores that
            keyed hash, not the raw address. Our hosting provider may process request logs under its own terms. We do
            not sell plan content or address data and we do not use advertising cookies.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>Do not use planny to publish or distribute:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>illegal content, malware, phishing, fraud or instructions for serious harm;</li>
            <li>child sexual abuse material or content that exploits or endangers a child;</li>
            <li>another person&apos;s personal data or confidential information without permission;</li>
            <li>harassment, threats, hate or content that violates someone&apos;s privacy or rights;</li>
            <li>spam, deceptive links, or content that evades the rate limits, sanitiser or plan CSP;</li>
            <li>content that interferes with the service or another person&apos;s use of it.</li>
          </ul>
          <p>
            We may remove any plan, with or without notice, if we believe it breaks these terms, the law or the
            security of the service. We are not obliged to monitor every plan.
          </p>
        </Section>

        <Section title="Takedowns">
          <p>
            If you believe a plan should be removed, contact{' '}
            <a className="text-zinc-300 underline hover:text-white" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            Include the plan URL, what is wrong, and enough information for us to verify the request. We may remove
            the plan and keep the record described above. A takedown does not guarantee that every edge cache has
            already expired; we purge the plan&apos;s cache tag and the cache TTL is the fallback.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            The plan HTML is deleted from the Blob store when it expires, is deleted by its uploader, or is taken
            down. Cached copies may remain at the edge until the cache expires (currently up to one hour) or is
            purged.
          </p>
          <p>
            The record described above is kept after the HTML is gone. As of the effective date, it has no automatic
            expiry and is kept indefinitely. We will update these terms before applying a different retention period.
            The record may be kept for legal, security, abuse-prevention and operational reasons.
          </p>
        </Section>

        <Section title="Disclaimers and liability">
          <p>
            To the maximum extent permitted by law, the service is provided &quot;as is&quot; and &quot;as
            available&quot;, without warranties of any kind, including fitness for a particular purpose, accuracy,
            security or non-infringement. We do not warrant that a plan will be available, complete, private or free
            of harmful content.
          </p>
          <p>
            To the maximum extent permitted by law, we are not liable for indirect, incidental, special or
            consequential loss, or for loss of profits, data, goodwill or opportunity, arising from the service or a
            plan. Our total liability for all claims relating to the service is limited to £100. Nothing in these
            terms limits liability for death or personal injury caused by negligence, fraud, or any liability that
            cannot be limited by law.
          </p>
          <p>
            You are responsible for your plan and for any claim arising from it. You will indemnify us against
            third-party claims, losses and costs arising from your plan, your breach of these terms or your misuse of
            the service, to the extent permitted by law.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            We may update these terms. The current version is at this address, with the effective date. Continued use
            after an update means you accept the updated terms. If a change is material, we will make that clear on
            this page.
          </p>
          <p>
            For takedowns, legal notices and terms questions, use the contact above. For security vulnerabilities,
            email {CONTACT} with &quot;planny security&quot; in the subject.
          </p>
          <p>
            These terms are governed by the laws of England and Wales, and the courts of England and Wales have
            exclusive jurisdiction, except where consumer law gives you a different right.
          </p>
        </Section>
      </div>
    </article>
  );
}
