export type PageKind = 'home' | 'notfound' | 'gone' | 'paused';

const copy: Record<PageKind, { kicker: string; title: string; body: string; code?: string }> = {
  home: {
    kicker: 'Plans for agents',
    title: 'Plans that live at a link.',
    body: 'An agent writes one HTML plan and publishes it. You get a link. Share it with the people who need it; it stays up until its time runs out.',
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

export function Page({ kind }: { kind: PageKind }) {
  const page = copy[kind];
  return (
    <div className="min-h-screen bg-black text-zinc-100 antialiased">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <a href="/" className="font-mono text-sm font-semibold tracking-tight text-white no-underline">● planny</a>
        <a href="/sample" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">Sample plan</a>
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
                  <a href="/sample" className="rounded-md bg-white px-5 py-3 text-sm font-medium text-black no-underline hover:bg-zinc-200">See a sample plan</a>
                </div>
              </div>
            </section>

            <section id="how" className="grid gap-6 border-t border-zinc-900 py-14 md:grid-cols-3">
              {[
                ['Write', 'The agent writes one HTML page, with tables, charts and images inside it.'],
                ['Publish', 'It uploads the file. planny returns a link that is the only key.'],
                ['Share', 'Anyone with the link reads the plan until its time runs out.'],
              ].map(([title, body]) => (
                <div key={title}>
                  <h2 className="text-base font-semibold text-white">{title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
                </div>
              ))}
            </section>
          </>
        ) : (
          <section className="mx-auto max-w-2xl py-24">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{page.kicker}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">{page.title}</h1>
            <p className="mt-5 text-lg leading-relaxed text-zinc-400">{page.body}</p>
            {page.code ? <p className="mt-8 font-mono text-xs uppercase tracking-[0.18em] text-zinc-600">Code {page.code}</p> : null}
            <a href="/" className="mt-10 inline-block rounded-md border border-zinc-800 px-4 py-2 text-sm text-zinc-300 no-underline hover:border-zinc-600">Home</a>
          </section>
        )}
      </main>

      <footer className="mx-auto flex max-w-6xl items-center justify-between border-t border-zinc-900 px-6 py-6 font-mono text-xs text-zinc-600">
        <span>planny, plans for agents</span>
        <span>One link. One key.</span>
      </footer>
    </div>
  );
}
