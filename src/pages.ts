import { MiB, type AppConfig } from './config.js';
import { escapeHtml as esc } from './util.js';

export type Build = 'local' | 'vercel';

export type PauseGuard = 'stored' | 'uploads' | 'reads' | 'bytes' | 'owner_bytes';

interface LayoutInput {
  readonly build: Build;
  readonly title: string;
  readonly stamp?: string;
  readonly body: string;
  readonly rows?: readonly (readonly [string, string])[] | null;
}

export function formatUtc(ms: number): string {
  if (!ms) return 'Unknown';
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
  return `${text} UTC`;
}

export function sizeText(bytes: number): string {
  return `${bytes / MiB} MiB (${bytes.toLocaleString('en-US')} bytes)`;
}

export function nextMonthStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function titleBlock(rows: readonly (readonly [string, string])[]): string {
  const cells = rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  return `<dl class="block">${cells}</dl>`;
}

function layout({ title, stamp, body, rows = null }: LayoutInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>${esc(title)} | planny</title>
<link rel="stylesheet" href="/planny.css">
</head>
<body>
<div class="shell">
<header class="top">
<p class="wordmark"><a href="/">planny</a></p>
</header>
<main>
${stamp ? `<p class="status">${esc(stamp)}</p>` : ''}
${body}
${rows ? titleBlock(rows) : ''}
</main>
<p class="foot"><span>planny, plans for agents</span><span>One link. One key.</span></p>
</div>
</body>
</html>
`;
}

export function home({ build, config }: { build: Build; origin: string; config: AppConfig }): string {
  const size = sizeText(config.maxBodyBytes);
  const body = `
<div class="home-grid">
<section class="intro">
<p class="kicker">For AI agents</p>
<h1>One HTML file in. One link out.</h1>
<p class="lede">An agent uploads a plan as one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only key, so share it only with people who should see the plan.</p>
<p class="note">Open source under MIT. The whole app, including self-hosting, is on <a href="https://github.com/frasergriffiths/planny">GitHub</a>.</p>
</section>
<section class="upload">
<h2>Upload a plan</h2>
<p>Send the HTML as the raw request body. Put the name and the time the plan stays up in the query string.</p>
<pre><code>curl -X POST "https://use-planny.vercel.app/plans?name=Q4%20rollout&amp;duration=90d" \\
  -H "Content-Type: text/html" \\
  --data-binary @plan.html</code></pre>
<p>The reply is JSON with the link, the expiry time and a delete key. planny shows the delete key once, so keep it.</p>
</section>
</div>
<h2>Rules</h2>
${titleBlock([
    ['Size', `${size} per plan, embedded images included`],
    ['Time', `1 hour to ${config.maxPlanYears} years. The default is 30 days.`],
    ['Links', 'Removed. Plans have no clickable links.'],
    ['Scripts', 'Removed, with forms, frames and outside files. Charts can be inline SVG or CSS.'],
  ])}`;
  return layout({ build, title: 'Plans for agents', body });
}

export function notFound({ build }: { build: Build }): string {
  return layout({
    build,
    title: 'No plan at this link',
    stamp: 'No plan',
    body: '<h1>No plan at this link.</h1><p>Check the whole address. A plan link ends with the code the upload returned.</p>',
    rows: [['Status', 'Not found'], ['Code', '404']],
  });
}

export function expired({ build, expiresAt, name }: { build: Build; expiresAt: number; name?: string }): string {
  return layout({
    build,
    title: 'This plan has expired',
    stamp: 'Expired',
    body: '<h1>This plan has expired.</h1><p>Ask the author to upload it again. A plan stays up for the time its author set.</p>',
    rows: [...(name ? [['Plan', name] as const] : []), ['Status', 'Expired'], ['Ended', formatUtc(expiresAt)], ['Code', '410']],
  });
}

export function deleted({ build, removedAt }: { build: Build; removedAt: number }): string {
  return layout({
    build,
    title: 'Deleted',
    stamp: 'Deleted',
    body: '<h1>The author deleted this plan.</h1><p>The link no longer works. The author can upload a new plan.</p>',
    rows: [['Status', 'Deleted'], ['Removed', formatUtc(removedAt)], ['Code', '410']],
  });
}

export function takedown({ build, removedAt }: { build: Build; removedAt: number }): string {
  return layout({
    build,
    title: 'Taken down',
    stamp: 'Taken down',
    body: '<h1>planny took this plan down.</h1><p>The link no longer works. If someone sent you this link, ask them what happened.</p>',
    rows: [['Status', 'Taken down'], ['Removed', formatUtc(removedAt)], ['Code', '410']],
  });
}

export function rateLimited({ build, retryAfter }: { build: Build; retryAfter: number }): string {
  return layout({
    build,
    title: 'Too many requests',
    stamp: 'Wait',
    body: `<h1>Too many requests from this address.</h1><p>Wait ${esc(String(retryAfter))} seconds, then reload this page.</p>`,
    rows: [['Status', 'Rate limited'], ['Retry in', `${retryAfter} s`], ['Code', '429']],
  });
}

const PAUSE_TEXT: Readonly<Record<PauseGuard, { readonly heading: string; readonly detail: string; readonly path: 'reads' | 'uploads' }>> = {
  reads: {
    heading: 'New plan reads are paused.',
    detail: 'The monthly limit for plan reads is used up.',
    path: 'reads',
  },
  bytes: {
    heading: 'New plan reads are paused.',
    detail: 'The monthly limit for plan data read is used up.',
    path: 'reads',
  },
  owner_bytes: {
    heading: 'Reads from your address are paused.',
    detail: 'This address has used its monthly share of plan data read.',
    path: 'reads',
  },
  stored: {
    heading: 'Uploads are paused.',
    detail: 'planny has no room for new plans right now.',
    path: 'uploads',
  },
  uploads: {
    heading: 'Uploads are paused.',
    detail: 'The monthly limit for uploads is used up.',
    path: 'uploads',
  },
};

export function paused({ build, guard, resumesAt }: { build: Build; guard: PauseGuard; resumesAt: number }): string {
  const copy = PAUSE_TEXT[guard];
  const resume = copy.path === 'reads'
    ? `Reading starts again on ${formatUtc(resumesAt)}. Uploads keep working.`
    : `Uploads start again on ${formatUtc(resumesAt)}. Reading keeps working.`;
  return layout({
    build,
    title: 'Paused',
    stamp: 'Paused',
    body: `<h1>${esc(copy.heading)}</h1><p>${esc(copy.detail)} ${esc(resume)} Deletes and takedowns still work.</p>`,
    rows: [['Status', 'Paused'], ['Resumes', formatUtc(resumesAt)], ['Code', '503']],
  });
}



export function notConfigured({ build }: { build: Build }): string {
  return layout({
    build,
    title: 'Not configured',
    stamp: 'Not configured',
    body: '<h1>planny is not configured yet.</h1><p>The deployment is missing its storage settings. Reads and uploads start once they are set.</p>',
    rows: [['Status', 'Not configured'], ['Code', '503']],
  });
}

export function serverError({ build }: { build: Build }): string {
  return layout({
    build,
    title: 'Server error',
    stamp: 'Error',
    body: '<h1>This plan could not be loaded.</h1><p>Something failed on planny. Reload this page in a minute.</p>',
    rows: [['Status', 'Server error'], ['Code', '500']],
  });
}

export function unknownPath({ build }: { build: Build }): string {
  return layout({
    build,
    title: 'No page here',
    stamp: 'Not found',
    body: '<h1>No page at this address.</h1><p>Plans open at /p/ followed by the plan code.</p>',
    rows: [['Status', 'Not found'], ['Code', '404']],
  });
}
