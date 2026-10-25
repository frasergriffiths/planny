import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

export type PageKind = 'home' | 'notfound' | 'gone' | 'paused';

const INSTALL_COMMAND = 'npx skills add frasergriffiths/planny --skill planny';
const MCP_TARBALL = 'https://github.com/frasergriffiths/planny/releases/download/mcp-v0.1.0/planny-mcp-0.1.0.tgz';
const MCP_COMMAND = `npx -y ${MCP_TARBALL}`;

const MCP_CLIENT_IDS = ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'codex', 'opencode'] as const;
type McpClientId = typeof MCP_CLIENT_IDS[number];

interface McpClientConfig {
  readonly label: string;
  /** The file path or command shown above the config block. */
  readonly where: string;
  readonly snippet: string;
  readonly copyLabel?: string;
  readonly note?: string;
}

// Each snippet is the same shape mcp/README.md documents for that client. The optional
// PLANNY_URL env is omitted here to keep the panel short; the README shows it.
const MCP_CLIENTS: Record<McpClientId, McpClientConfig> = {
  'claude-code': {
    label: 'Claude Code',
    where: 'Terminal (run once)',
    snippet: `claude mcp add --transport stdio planny -- npx -y ${MCP_TARBALL}`,
    copyLabel: 'Copy Claude Code command',
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    where: 'macOS: ~/Library/Application Support/Claude/claude_desktop_config.json · Windows: %APPDATA%\\Claude\\claude_desktop_config.json',
    snippet: `{
  "mcpServers": {
    "planny": {
      "command": "npx",
      "args": ["-y", "${MCP_TARBALL}"]
    }
  }
}`,
  },
  cursor: {
    label: 'Cursor',
    where: '~/.cursor/mcp.json or .cursor/mcp.json',
    snippet: `{
  "mcpServers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "${MCP_TARBALL}"]
    }
  }
}`,
  },
  vscode: {
    label: 'VS Code',
    where: '.vscode/mcp.json',
    snippet: `{
  "servers": {
    "planny": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "${MCP_TARBALL}"]
    }
  }
}`,
  },
  codex: {
    label: 'Codex',
    where: '~/.codex/config.toml',
    snippet: `[mcp_servers.planny]
command = "npx"
args = ["-y", "${MCP_TARBALL}"]`,
  },
  opencode: {
    label: 'OpenCode',
    where: '~/.config/opencode/opencode.jsonc',
    snippet: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "planny": {
        "type": "local",
        "command": ["npx", "-y", "${MCP_TARBALL}"]
      }
    }
  }
}`,
    note: `CLI: opencode mcp add planny --global -- npx -y ${MCP_TARBALL}`,
  },
};
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

function CopyGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 011-1h9" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

// The one icon-only copy control: a 7x7 square with the copy glyph, a check while the
// clipboard write is acknowledged, and the same sr-only live region for everyone.
function IconCopy({ copied, onClick, label }: {
  copied: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-bar text-zinc-400 hover:text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white"
    >
      {copied ? <CheckGlyph /> : <CopyGlyph />}
      <span className="sr-only" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
}

function InstallCommand() {
  const { copied, copy } = useCopy(INSTALL_COMMAND);
  return (
    <div className="flex w-fit max-w-full items-center gap-2">
      <code className="block min-w-0 overflow-x-auto whitespace-nowrap font-mono text-sm text-white">{INSTALL_COMMAND}</code>
      <IconCopy copied={copied} onClick={copy} label="Copy install command" />
    </div>
  );
}

// The MCP command is longer than a phone line, so it wraps instead of scrolling the page.
function McpCommand() {
  const { copied, copy } = useCopy(MCP_COMMAND);
  return (
    <div className="flex w-full max-w-full items-start gap-2">
      <code className="block min-w-0 flex-1 break-words whitespace-pre-wrap font-mono text-sm leading-relaxed text-white">{MCP_COMMAND}</code>
      <IconCopy copied={copied} onClick={copy} label="Copy MCP install command" />
    </div>
  );
}

function McpPanelCopy({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return <IconCopy copied={copied} onClick={copy} label={label} />;
}

// One client at a time keeps the section compact. The buttons are a labelled toggle group,
// so the selected client is exposed with aria-pressed rather than as a visual-only state.
function McpClients() {
  const [active, setActive] = useState<McpClientId>('claude-code');
  const client = MCP_CLIENTS[active];
  const copyLabel = client.copyLabel ?? `Copy ${client.label} config`;
  return (
    <div className="mt-5">
      <div role="group" aria-label="MCP client" className="flex flex-wrap gap-2">
        {MCP_CLIENT_IDS.map((id) => {
          const selected = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              aria-controls="mcp-client-panel"
              onClick={() => setActive(id)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 font-mono text-xs focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-white ${selected ? 'border-white bg-white text-black' : 'border-line text-zinc-400 hover:border-zinc-600 hover:text-white'}`}
            >
              {MCP_CLIENTS[id].label}
            </button>
          );
        })}
      </div>
      <div id="mcp-client-panel" role="region" aria-label={`${client.label} setup`} className="mt-4">
        <div className="flex items-start gap-3">
          <code className="min-w-0 flex-1 break-words font-mono text-xs leading-relaxed text-zinc-400">{client.where}</code>
          <McpPanelCopy key={active} value={client.snippet} label={copyLabel} />
        </div>
        <pre className="mt-2 max-w-full overflow-x-auto rounded-card border border-line bg-zinc-950/40 p-4 font-mono text-xs leading-relaxed text-zinc-300">
          <code>{client.snippet}</code>
        </pre>
        {client.note ? (
          <p className="mt-2 max-w-full break-words font-mono text-xs leading-relaxed text-zinc-500">{client.note}</p>
        ) : null}
      </div>
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
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <a href="/" className="font-mono text-sm font-semibold tracking-tight text-white no-underline">● planny</a>
        <nav className="flex items-center gap-5">
          <a href="/sample" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">Sample plan</a>
          <a href="/#mcp" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">MCP</a>
          <a href="/#install" className="font-mono text-xs tracking-wide text-zinc-400 no-underline hover:text-white">Install skill</a>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {kind === 'home' ? (
          <>
            <section className="py-16 md:py-24">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{page.kicker}</p>
                <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.05em] text-white md:text-7xl">{page.title}</h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">{page.body}</p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <a href="#install" className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black no-underline hover:bg-zinc-200">Install the skill</a>
                  <a href="/sample" className="rounded-full border border-line px-5 py-3 text-sm font-medium text-zinc-300 no-underline hover:border-zinc-600">See a sample plan</a>
                  <a href="#mcp" className="px-2 py-3 font-mono text-xs text-zinc-400 no-underline hover:text-white">Connect the MCP →</a>
                </div>
                <p className="mt-6 max-w-xl font-mono text-xs leading-relaxed text-zinc-500">
                  Open source under MIT. The whole app, including self-hosting, is on{' '}
                  <a href={withRef('https://github.com/frasergriffiths/planny', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">GitHub</a>.
                </p>
              </div>
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

            <section id="mcp" className="border-t border-line py-14">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">MCP server</p>
              <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white md:text-3xl">Connect planny as an MCP server.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
                Two tools, <code className="text-zinc-400">publish_plan</code> and <code className="text-zinc-400">delete_plan</code>, with no API key. Works with Claude Code, Claude Desktop, Cursor, VS Code, Codex, OpenCode and any stdio client.
              </p>
              <div className="mt-6 max-w-full">
                <McpCommand />
              </div>
              <p className="mt-4 max-w-xl font-mono text-xs leading-relaxed text-zinc-500">
                Node 22+ with npm/npx. Installs the version-pinned GitHub Release tarball; Bun is only for the clone-and-build fallback. A self-hosted instance sets <code className="text-zinc-400">PLANNY_URL</code>.
              </p>
              <McpClients />
              <p className="mt-6 flex flex-wrap gap-4 font-mono text-xs">
                <a href={withRef('https://github.com/frasergriffiths/planny/blob/main/mcp/README.md', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">MCP setup docs</a>
                <a href={withRef('https://github.com/frasergriffiths/planny/releases/tag/mcp-v0.1.0', REF)} target="_blank" rel="noreferrer" className="text-zinc-400 no-underline hover:text-white">mcp-v0.1.0 release</a>
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
