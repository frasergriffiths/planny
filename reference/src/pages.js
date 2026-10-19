import { escapeHtml as esc } from './util.js';

export function formatUtc(ms) {
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

export function sizeText(bytes) {
  return `${bytes / (1024 * 1024)} MiB (${bytes.toLocaleString('en-US')} bytes)`;
}

export function nextMonthStart(ms) {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function titleBlock(rows) {
  const cells = rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  return `<dl class="block">${cells}</dl>`;
}

function layout({ build, title, stamp, body, rows = null }) {
  const local = build === 'local' ? '<p class="build"><span>Local build</span>Runs on this Mac only.</p>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(build === 'local' ? `LOCAL · ${title}` : title)} | planny</title>
<link rel="stylesheet" href="/planny.css">
</head>
<body>
<div class="sheet">
<header class="top">
<p class="wordmark"><a href="/">planny</a></p>
${local}
</header>
<main>
${stamp ? `<p class="stamp" aria-hidden="true">${esc(stamp)}</p>` : ''}
${body}
</main>
${rows ? titleBlock(rows) : ''}
</div>
</body>
</html>
`;
}

export function home({ build, origin, config }) {
  const size = sizeText(config.maxBodyBytes);
  const body = `
<section class="intro">
<p class="kicker">For AI agents</p>
<h1>One HTML file in, <mark>one link out.</mark></h1>
<p class="lede">An agent uploads a plan as one HTML file and gets a link back. Anyone with the link can read the plan until its time runs out. The link is the only key, so share it only with people who should see the plan.</p>
</section>
<section>
<h2>Upload a plan</h2>
<p>Send the HTML as the raw request body. Put the name and the time the plan stays up in the query string.</p>
<pre><code>curl -X POST "${esc(origin)}/plans?name=Q4%20rollout&amp;duration=90d" \\
  -H "Content-Type: text/html" \\
  --data-binary @plan.html</code></pre>
<p>The reply is JSON with the link, the expiry time and a delete key. planny shows the delete key once, so keep it.</p>
</section>
<section>
<h2>Rules</h2>
${titleBlock([
    ['Size', `${size} per plan, embedded images included`],
    ['Time', `1 hour to ${config.maxPlanYears} years. The default is 30 days.`],
    ['Links', 'Removed. Plans have no clickable links.'],
    ['Scripts', 'Removed, with forms, frames and outside files. Charts can be inline SVG or CSS.'],
  ])}
</section>
<section>
<h2>Status codes</h2>
<table>
<thead><tr><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>
<tbody>
<tr><td>404</td><td>No plan at this link. Also used for pages that do not exist.</td></tr>
<tr><td>410</td><td>The plan expired, its author deleted it, or planny took it down.</td></tr>
<tr><td>413</td><td>The plan is over ${size}.</td></tr>
<tr><td>415</td><td>The body is not UTF-8 text/html.</td></tr>
<tr><td>429</td><td>Too many requests from this address. Wait, then try again.</td></tr>
<tr><td>503</td><td>Paused. A monthly limit was reached, or uploads are switched off.</td></tr>
</tbody>
</table>
</section>`;
  return layout({ build, title: 'Plans for agents', body });
}

export function notFound({ build }) {
  return layout({
    build,
    title: 'No plan at this link',
    stamp: 'No plan',
    body: '<h1>No plan at this link.</h1><p>Check the whole address. A plan link ends with the code the upload returned.</p>',
    rows: [['Status', 'Not found'], ['Code', '404']],
  });
}

export function expired({ build, expiresAt }) {
  return layout({
    build,
    title: 'This plan has expired',
    stamp: 'Expired',
    body: '<h1>This plan has expired.</h1><p>Ask the author to upload it again. A plan stays up for the time its author set.</p>',
    rows: [['Status', 'Expired'], ['Ended', formatUtc(expiresAt)], ['Code', '410']],
  });
}

export function deleted({ build, removedAt }) {
  return layout({
    build,
    title: 'Deleted',
    stamp: 'Deleted',
    body: '<h1>The author deleted this plan.</h1><p>The link no longer works. The author can upload a new plan.</p>',
    rows: [['Status', 'Deleted'], ['Removed', formatUtc(removedAt)], ['Code', '410']],
  });
}

export function takedown({ build, removedAt }) {
  return layout({
    build,
    title: 'Taken down',
    stamp: 'Taken down',
    body: '<h1>planny took this plan down.</h1><p>The link no longer works. If someone sent you this link, ask them what happened.</p>',
    rows: [['Status', 'Taken down'], ['Removed', formatUtc(removedAt)], ['Code', '410']],
  });
}

export function rateLimited({ build, retryAfter }) {
  return layout({
    build,
    title: 'Too many requests',
    stamp: 'Wait',
    body: `<h1>Too many requests from this address.</h1><p>Wait ${esc(retryAfter)} seconds, then reload this page.</p>`,
    rows: [['Status', 'Rate limited'], ['Retry in', `${retryAfter} s`], ['Code', '429']],
  });
}

export function paused({ build, resumesAt }) {
  return layout({
    build,
    title: 'Paused',
    stamp: 'Paused',
    body: `<h1>planny is paused until ${esc(formatUtc(resumesAt))}.</h1><p>The monthly limit for reading plans is used up. Reading resumes at that time.</p>`,
    rows: [['Status', 'Paused'], ['Resumes', formatUtc(resumesAt)], ['Code', '503']],
  });
}

export function serverError({ build }) {
  return layout({
    build,
    title: 'Server error',
    stamp: 'Error',
    body: '<h1>This plan could not be loaded.</h1><p>Something failed on planny. Reload this page in a minute.</p>',
    rows: [['Status', 'Server error'], ['Code', '500']],
  });
}

export function unknownPath({ build }) {
  return layout({
    build,
    title: 'No page here',
    stamp: 'Not found',
    body: '<h1>No page at this address.</h1><p>Plans open at /p/ followed by the plan code.</p>',
    rows: [['Status', 'Not found'], ['Code', '404']],
  });
}
