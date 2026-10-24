import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

export type PageKind = 'home' | 'notfound' | 'gone' | 'paused';

const INSTALL_COMMAND = 'npx skills add frasergriffiths/planny --skill planny';
// Keep in step with PLUR in src/attribution.ts. The server marks the flag on <html>.
const PLUR = 'https://use-planny.vercel.app';

// Every link that leaves the site says which surface sent the visitor. Analytics reads the
// first page's URL, so `/?ref=plan` from a plan footer is distinguishable from direct traffic.
const REF = 'site';
function withRef(url: string, ref: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`;
}

const stepIcon = {
  write: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.5 3.5l4 4L8 20H4v-4L16.5 3.5z" />
      <path d="M14 6l4 4" />
    </svg>
  ),
  publish: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M6.5 9.5L12 4l5.5 5.5" />
      <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </svg>
  ),
  share: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7l1.2-1.2" />
    </svg>
  ),
} as const;

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex w-fit max-w-full items-center gap-2">
      <code className="block min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-white">{INSTALL_COMMAND}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy install command"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-bar text-zinc-400 hover:text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white"
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4.5 12.5l5 5 10-11" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a1 1 0 011-1h9" />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={label}
      className="flex h-7 flex-none cursor-pointer items-center justify-center rounded-bar border border-line px-2 font-mono text-xs text-zinc-400 hover:border-zinc-600 hover:text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white"
    >
      {copied ? 'Copied' : 'Copy'}
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

type PublishState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; url: string; deleteKey: string; expiresAt: string }
  | { status: 'error'; message: string };

// The demo box posts to its own endpoint, which has a fixed 24-hour life and a separate
// monthly counter, so a public demo cannot spend the site-wide upload budget. It is the same
// sanitiser and the same body cap as an agent's upload; the server decides that, not this form.
function PublishBox() {
  const [html, setHtml] = useState('');
  const [state, setState] = useState<PublishState>({ status: 'idle' });
  const sending = state.status === 'sending';
  const canPublish = !sending && html.trim().length > 0;

  const publish = async () => {
    if (!canPublish) return;
    setState({ status: 'sending' });
    try {
      const response = await fetch('/demo/plans', {
        method: 'POST',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html,
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        deleteKey?: string;
        expiresAt?: string;
        error?: { message?: string };
      };
      if (!response.ok || !data.url || !data.deleteKey || !data.expiresAt) {
        setState({ status: 'error', message: data.error?.message ?? `Publishing failed (${response.status}).` });
        return;
      }
      setState({ status: 'done', url: data.url, deleteKey: data.deleteKey, expiresAt: data.expiresAt });
    } catch {
      setState({ status: 'error', message: 'Could not reach planny. Check your connection and try again.' });
    }
  };

  // Once the plan is published the form is replaced, not just disabled: a second click
  // cannot publish a duplicate plan, and the only way to start again is an explicit reload.
  if (state.status === 'done') {
    return (
      <div className="mt-6 plan-card">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Your link</p>
        <p className="mt-2 break-all text-sm">
          <a href={state.url} className="text-white underline underline-offset-2 hover:text-zinc-300">{state.url}</a>
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-500">Expires {new Date(state.expiresAt).toLocaleString()}</p>
        <div className="mt-5 border-t border-line pt-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Delete key — copy it now</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-xs text-zinc-300">{state.deleteKey}</code>
            <CopyButton value={state.deleteKey} label="Copy delete key" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            planny shows this once. It is the only way to delete the plan early; the link expires in 24 hours either way.
          </p>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          The box closes after a publish so a second click cannot create a duplicate. Reload the page to publish another plan.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <label htmlFor="plan-html" className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Your HTML</label>
      <textarea
        id="plan-html"
        value={html}
        onChange={(event) => setHtml(event.target.value)}
        spellCheck={false}
        placeholder={'<!doctype html>\n<html><body><h1>Q4 rollout</h1><p>One page, one link.</p></body></html>'}
        className="mt-2 h-48 w-full resize-y rounded-card border border-line bg-transparent p-4 font-mono text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-700 focus:border-zinc-600 focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={publish}
          disabled={!canPublish}
          className="cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-medium text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {sending ? 'Publishing…' : 'Get a link'}
        </button>
        <p className="font-mono text-xs text-zinc-500">Expires in 24 hours. No account.</p>
      </div>

      {state.status === 'error' ? (
        <p role="alert" className="mt-4 text-sm text-red-400">{state.message}</p>
      ) : null}
    </div>
  );
}

const copy: Record<PageKind, { kicker: string; title: string; body: string; code?: string }> = {
  home: {
    kicker: 'Plans for agents',
    title: 'Share an HTML plan as a link',
    body: 'Sanitised, expiring, no account. Built for plans your agent writes.',
  },
  notfound: {
    kicker: 'No plan',
    title: 'No plan at this link.',
    body: 'Check the whole address. A plan link ends with the code the upload returned.',
    code: '404',
  },
  gone: {
    kicker: 'Gone',
    title: 'This plan is no longer here.',
    body: 'It expired, its author deleted it, or planny took it down.',
    code: '410',
  },
  paused: {
    kicker: 'Paused',
    title: 'planny is paused.',
    body: 'A limit was reached. Reading resumes at the reset time.',
    code: '503',
  },
};

// The invite belongs to the plan 404/410 pages only. The server marks just those
// responses with data-planny-invite, so the generic 404, the 429 page and every page
// served without the marker stay free of it.
export function inviteVisible(kind: PageKind, dataset: { plannyInvite?: string }): boolean {
  return (kind === 'notfound' || kind === 'gone') && dataset.plannyInvite === 'on';
}

export function Page({ kind }: { kind: PageKind }) {
  const page = copy[kind];
  // The built pages render after #root, so the invite has to be part of this tree.
  const dataset = typeof document === 'undefined' ? {} : document.documentElement.dataset;
  return (
    <div className="min-h-screen bg-black text-zinc-100 antialiased">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a href="/" className="font-mono text-sm font-semibold tracking-tight text-white no-underline">● planny</a>
        <a href="/sample" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">Sample plan</a>
        <a href="#install" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">Install skill</a>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {kind === 'home' ? (
          <>
            <section className="py-16 md:py-24">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{page.kicker}</p>
                <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.05em] text-white md:text-7xl">{page.title}</h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">{page.body}</p>
                <div className="mt-9 flex flex-wrap gap-3">
                  <a href="#try" className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black no-underline hover:bg-zinc-200">Paste HTML, get a link</a>
                  <a href="/sample" className="rounded-full border border-line px-5 py-3 text-sm font-medium text-zinc-300 no-underline hover:border-zinc-600">See a sample plan</a>
                  <a href="#install" className="rounded-full border border-line px-5 py-3 text-sm font-medium text-zinc-300 no-underline hover:border-zinc-600">Install the skill</a>
                </div>
                <p className="mt-6 max-w-xl font-mono text-xs leading-relaxed text-zinc-500">
                  Open source under MIT. The whole app, including self-hosting, is on{' '}
                  <a href={withRef('https://github.com/frasergriffiths/planny', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">GitHub</a>.
                </p>
              </div>
            </section>

            <section id="try" className="border-t border-line py-14">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">Try it</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white md:text-3xl">Paste HTML. Get a link.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
                The same thing your agent does, without installing anything. Paste one self-contained page and planny
                returns a link plus a delete key. Scripts, links, forms and frames are stripped by the server-side
                sanitiser exactly as they are for every upload, so the link is safe to send to anyone.
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
                Demo links last 24 hours and have their own monthly allowance, so they never eat the uploads your
                agents rely on.
              </p>
              <PublishBox />
            </section>

            <section id="install" className="border-t border-line py-14">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">Agent skill</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white md:text-3xl">Install the skill. Ask for a plan.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
                One command installs the skill into Claude Code, Cursor, Codex, OpenCode and other agents. It ships four plan templates (project, launch, research and decision), writes the HTML, uploads it, and keeps the delete key private.
              </p>
              <div className="mt-6">
                <InstallCommand />
              </div>
              <p className="mt-4 max-w-xl font-mono text-xs text-zinc-500">
                Add -g to install globally. Bun users can run <code className="text-zinc-400">bunx skills add frasergriffiths/planny --skill planny</code>. Runs on Node 22+ or Bun.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
                After install, ask your agent: <span className="text-white">“Publish this plan with Planny.”</span>
              </p>
              <p className="mt-6 flex flex-wrap gap-4 font-mono text-xs">
                <a href={withRef('https://www.skills.sh/frasergriffiths/planny/planny', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">skills.sh page</a>
                <a href={withRef('https://github.com/frasergriffiths/planny/tree/main/skills/planny', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">Skill source</a>
              </p>
            </section>

            <section id="how" className="grid gap-6 border-t border-line py-14 md:grid-cols-3">
              {([
                ['Write', 'The agent writes one HTML page, with tables, charts and images inside it.', stepIcon.write],
                ['Publish', 'It uploads the file. planny returns a link that is the only key.', stepIcon.publish],
                ['Share', 'Anyone with the link reads the plan until its time runs out.', stepIcon.share],
              ] as const).map(([title, body, icon]) => (
                <div key={title} className="plan-card-outline">
                  <div className="flex items-center gap-2.5">
                    <span className="text-zinc-300" aria-hidden="true">{icon}</span>
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
                </div>
              ))}
            </section>

            <section className="border-t border-line py-14">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white md:text-3xl">What you can publish</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">One self-contained HTML page per plan. Common uses:</p>
              <ul className="mt-6 grid gap-3 text-sm text-zinc-400 sm:grid-cols-3">
                {[
                  ['Agent runbooks', 'The operating procedure your agent wrote, shared as a link that expires on its own.'],
                  ['Research one-pagers', 'A summary with a table, a chart and sources, all inside the one file.'],
                  ['Project plans', 'Milestones, budgets and risks, shared with people outside your tools.'],
                ].map(([title, body]) => (
                  <li key={title} className="plan-card">
                    <p className="font-semibold text-white">{title}</p>
                    <p className="mt-2 leading-relaxed text-zinc-500">{body}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="border-t border-line py-14">
              <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white md:text-3xl">Questions</h2>
              <dl className="mt-6 max-w-3xl">
                {[
                  ['Do I need an account?', 'No. Paste the HTML, choose a lifetime, keep the delete key.'],
                  ['How long does a link last, and can I delete it early?', 'One hour to 100 years; it expires on its own, or delete it with the delete key returned at upload.'],
                  ['Is the link private?', 'No. Anyone with the link can read it. Plans are not listed, but a shared link can be indexed, so keep out secrets and personal data.'],
                  ['What can I publish?', 'One self-contained HTML file up to 4 MiB. Scripts, links, forms, frames, external files and fonts are stripped; CSS, inline SVG, tables and data: images work. That makes plans unsuitable for reports that need clickable sources.'],
                ].map(([q, a]) => (
                  <div key={q} className="border-t border-line py-5">
                    <dt className="text-sm font-semibold text-white">{q}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-zinc-500">{a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </>
        ) : (
          <section className="plan-card mx-auto my-16 max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{page.kicker}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">{page.title}</h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">{page.body}</p>
            {page.code ? <p className="mt-8 font-mono text-xs uppercase tracking-[0.18em] text-zinc-600">Code {page.code}</p> : null}
            <a href="/" className="rounded-bar mt-10 inline-block border border-line px-4 py-2 text-sm text-zinc-300 no-underline hover:border-zinc-600">Home</a>
            {inviteVisible(kind, dataset) ? (
              <p data-planny-invite className="mt-6 text-sm leading-relaxed text-zinc-400">
                Have a plan of your own?{' '}
                <a href={withRef(PLUR, 'invite')} rel="noopener" className="text-white underline underline-offset-2 hover:text-zinc-300">Publish it with Planny</a>.
              </p>
            ) : null}
          </section>
        )}
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-6 font-mono text-xs text-zinc-600">
        <span>
          planny, plans for agents · <a href={withRef('https://github.com/frasergriffiths/planny/blob/main/docs/terms-of-use.md', REF)} target="_blank" rel="noreferrer" className="text-zinc-500 no-underline hover:text-white">Terms</a>
          {' · '}
          <a href={withRef('https://github.com/frasergriffiths/planny/blob/main/PRIVACY.md', REF)} target="_blank" rel="noreferrer" className="text-zinc-500 no-underline hover:text-white">Privacy</a>
          {' · '}
          <a href={withRef('https://github.com/frasergriffiths/planny/blob/main/ACCEPTABLE_USE.md', REF)} target="_blank" rel="noreferrer" className="text-zinc-500 no-underline hover:text-white">Acceptable use</a>
          {' · '}
          <a href={withRef('https://github.com/frasergriffiths/planny/blob/main/THIRD_PARTY_NOTICES.md', REF)} target="_blank" rel="noreferrer" className="text-zinc-500 no-underline hover:text-white">Licences</a>
        </span>
        <span>One link. One key.</span>
      </footer>
      <Analytics />
    </div>
  );
}
