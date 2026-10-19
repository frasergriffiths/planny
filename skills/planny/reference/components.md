# Planny plan components

Copy these into a plan HTML file. They are built for planny's viewer: no scripts, no links, no forms, no frames and no external files. Charts are inline SVG or CSS. Images, if you use them, must be `data:image/png`, `jpeg`, `gif`, `webp` or `avif`. Keep the whole file under 4 MiB (4,194,304 bytes).

The server sanitises every plan anyway. These components are written to survive that pass unchanged, so what you preview is what readers get.

## Shared tokens

Put this once in the plan's `<style>` block. Adjust the accent, keep the contrast.

```html
<style>
  :root {
    --paper: #000000;
    --panel: #0a0a0a;
    --ink: #f5f5f5;
    --muted: #a1a1a1;
    --line: #262626;
    --accent: #3291FF;
    --accent-soft: #0b1b33;
    --ok: #4ade80;
    --warn: #fbbf24;
    --danger: #f87171;
    --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.55;
  }
  .page { width: 100%; max-width: none; padding: clamp(20px, 4vw, 64px); }
  .measure { max-width: 72ch; }
</style>
```

## KPI cards

```html
<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
  <div style="padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
    <div style="font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Week 1</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">1</strong>
    <span style="font-size:12px;color:var(--muted);">private store live</span>
  </div>
  <div style="padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
    <div style="font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Target</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">&lt; 2s</strong>
    <span style="font-size:12px;color:var(--muted);">p95 first view</span>
  </div>
  <div style="padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
    <div style="font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Cap</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">4 MiB</strong>
    <span style="font-size:12px;color:var(--muted);">per plan</span>
  </div>
  <div style="padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
    <div style="font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Guard</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">200 GB</strong>
    <span style="font-size:12px;color:var(--muted);">origin reads a month</span>
  </div>
</div>
```

At narrow widths, add:

```html
<style>
  @media (max-width: 700px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
```

## Progress bar

```html
<div style="margin:12px 0;">
  <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:13px;">
    <span>Private store cutover</span><span style="color:var(--muted);font-family:var(--mono);">72%</span>
  </div>
  <div style="height:10px;border-radius:999px;background:var(--line);overflow:hidden;">
    <div style="height:100%;width:72%;border-radius:999px;background:var(--accent);"></div>
  </div>
</div>
```

## Inline SVG bar chart

No JavaScript. Replace the values and labels.

```html
<svg viewBox="0 0 640 260" role="img" aria-label="Monthly uploads, January to June" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="#a1a1a1">
    <line x1="64" y1="20" x2="64" y2="210" stroke="#262626"></line>
    <line x1="64" y1="210" x2="610" y2="210" stroke="#262626"></line>
    <text x="18" y="214">0</text>
    <text x="18" y="164">500</text>
    <text x="18" y="114">1,000</text>
    <text x="18" y="64">1,500</text>
    <rect x="96" y="150" width="54" height="60" rx="4" fill="#3291FF"></rect>
    <rect x="180" y="120" width="54" height="90" rx="4" fill="#3291FF"></rect>
    <rect x="264" y="90" width="54" height="120" rx="4" fill="#3291FF"></rect>
    <rect x="348" y="70" width="54" height="140" rx="4" fill="#3291FF"></rect>
    <rect x="432" y="110" width="54" height="100" rx="4" fill="#3291FF"></rect>
    <rect x="516" y="40" width="54" height="170" rx="4" fill="#3291FF"></rect>
    <text x="123" y="228" text-anchor="middle">Jan</text>
    <text x="207" y="228" text-anchor="middle">Feb</text>
    <text x="291" y="228" text-anchor="middle">Mar</text>
    <text x="375" y="228" text-anchor="middle">Apr</text>
    <text x="459" y="228" text-anchor="middle">May</text>
    <text x="543" y="228" text-anchor="middle">Jun</text>
  </g>
</svg>
```

## Inline SVG line chart

```html
<svg viewBox="0 0 640 260" role="img" aria-label="Origin reads per week" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="#a1a1a1">
    <line x1="56" y1="20" x2="56" y2="208" stroke="#262626"></line>
    <line x1="56" y1="208" x2="612" y2="208" stroke="#262626"></line>
    <line x1="56" y1="158" x2="612" y2="158" stroke="#1a1a1a"></line>
    <line x1="56" y1="108" x2="612" y2="108" stroke="#1a1a1a"></line>
    <line x1="56" y1="58" x2="612" y2="58" stroke="#1a1a1a"></line>
    <polyline points="56,184 138,170 220,150 302,158 384,120 466,96 548,64 612,52" fill="none" stroke="#3291FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <circle cx="56" cy="184" r="4" fill="#3291FF"></circle>
    <circle cx="138" cy="170" r="4" fill="#3291FF"></circle>
    <circle cx="220" cy="150" r="4" fill="#3291FF"></circle>
    <circle cx="302" cy="158" r="4" fill="#3291FF"></circle>
    <circle cx="384" cy="120" r="4" fill="#3291FF"></circle>
    <circle cx="466" cy="96" r="4" fill="#3291FF"></circle>
    <circle cx="548" cy="64" r="4" fill="#3291FF"></circle>
    <circle cx="612" cy="52" r="4" fill="#3291FF"></circle>
    <text x="56" y="228" text-anchor="middle">W1</text>
    <text x="138" y="228" text-anchor="middle">W2</text>
    <text x="220" y="228" text-anchor="middle">W3</text>
    <text x="302" y="228" text-anchor="middle">W4</text>
    <text x="384" y="228" text-anchor="middle">W5</text>
    <text x="466" y="228" text-anchor="middle">W6</text>
    <text x="548" y="228" text-anchor="middle">W7</text>
    <text x="612" y="228" text-anchor="middle">W8</text>
  </g>
</svg>
```

## Inline SVG donut

`stroke-dasharray` is the arc. For 78 percent on a 239 circumference, use about `186 239`. Adjust both numbers together.

```html
<div style="display:flex;align-items:center;gap:16px;">
  <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Confidence 78 percent">
    <circle cx="48" cy="48" r="40" fill="none" stroke="#262626" stroke-width="10"></circle>
    <circle cx="48" cy="48" r="40" fill="none" stroke="#3291FF" stroke-width="10" stroke-linecap="round" stroke-dasharray="196 251" transform="rotate(-90 48 48)"></circle>
    <text x="48" y="54" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="700" fill="#f5f5f5">78%</text>
  </svg>
  <p style="margin:0;font-size:13px;color:var(--muted);">Two unknowns remain. Both have owners and dates.</p>
</div>
```

## CSS grid Gantt

```html
<div style="margin:16px 0;font-size:12px;">
  <div style="display:grid;grid-template-columns:180px repeat(8,minmax(0,1fr));gap:6px;margin-bottom:6px;color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;">
    <div>Workstream</div><div>W1</div><div>W2</div><div>W3</div><div>W4</div><div>W5</div><div>W6</div><div>W7</div><div>W8</div>
  </div>
  <div style="display:grid;grid-template-columns:180px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
    <div style="font-weight:650;">Store + upload</div>
    <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:28px;">
      <div style="grid-row:1;grid-column:1 / span 2;display:flex;align-items:center;padding:0 9px;border-radius:6px;background:var(--accent);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">201, delete key, 4 MiB</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:180px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
    <div style="font-weight:650;">View + cache</div>
    <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:28px;">
      <div style="grid-row:1;grid-column:2 / span 3;display:flex;align-items:center;padding:0 9px;border-radius:6px;background:var(--ink);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">200, TTL, purge</div>
    </div>
  </div>
</div>
```

At narrow widths, shrink the label column:

```html
<style>
  @media (max-width: 700px) {
    .gantt-row, .gantt-head { grid-template-columns: 112px repeat(8, minmax(18px, 1fr)); }
  }
</style>
```

## Decision matrix

```html
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <thead>
    <tr>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Decision</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Option A</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Option B</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Call</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);font-weight:650;">Viewer runtime</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);">Scripts on. Interactive charts.</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);">Scripts off. Static SVG and CSS.</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);color:var(--accent);font-weight:700;">Scripts off</td>
    </tr>
  </tbody>
</table>
```

## Risk register

```html
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <thead>
    <tr>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Risk</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Likelihood</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Impact</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Mitigation</th>
      <th scope="col" style="text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--panel);font:10px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);">Owner</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);">A popular plan exhausts the read budget</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);color:var(--warn);font-weight:700;">Medium</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);color:var(--warn);font-weight:700;">Medium</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);">One-hour TTL, per-plan alert at 1,000 origin reads an hour, and the 200 GB guard.</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--line);">Steven</td>
    </tr>
  </tbody>
</table>
```

## Architecture diagram

Inline SVG boxes and lines. No markers or external references.

```html
<svg viewBox="0 0 720 300" role="img" aria-label="Agent to planny to Blob and Redis" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel);">
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#f5f5f5">
    <rect x="30" y="110" width="150" height="70" rx="10" fill="#0a0a0a" stroke="#2b4a7a"></rect>
    <text x="105" y="140" text-anchor="middle" font-weight="700">Agent</text>
    <text x="105" y="160" text-anchor="middle" fill="#a1a1a1">one HTML file</text>
    <rect x="285" y="95" width="170" height="100" rx="10" fill="#3291FF"></rect>
    <text x="370" y="130" text-anchor="middle" fill="#0a0a0a" font-weight="700">planny</text>
    <text x="370" y="152" text-anchor="middle" fill="#dbeafe">sanitise, store, link</text>
    <rect x="555" y="45" width="140" height="70" rx="10" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="75" text-anchor="middle" font-weight="700">Blob</text>
    <text x="625" y="95" text-anchor="middle" fill="#a1a1a1">private HTML</text>
    <rect x="555" y="185" width="140" height="70" rx="10" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="215" text-anchor="middle" font-weight="700">Upstash</text>
    <text x="625" y="235" text-anchor="middle" fill="#a1a1a1">records, counters</text>
    <line x1="180" y1="145" x2="285" y2="145" stroke="#f5f5f5" stroke-width="2"></line>
    <polygon points="285,145 275,140 275,150" fill="#f5f5f5"></polygon>
    <line x1="455" y1="130" x2="555" y2="90" stroke="#f5f5f5" stroke-width="2"></line>
    <polygon points="555,90 544,90 548,99" fill="#f5f5f5"></polygon>
    <line x1="455" y1="165" x2="555" y2="210" stroke="#f5f5f5" stroke-width="2"></line>
    <polygon points="555,210 548,201 544,210" fill="#f5f5f5"></polygon>
  </g>
</svg>
```

## Callouts

```html
<div style="margin:20px 0;padding:18px 20px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;background:var(--accent-soft);">
  <strong style="display:block;margin-bottom:4px;">Note</strong>
  <p style="margin:0;">Plans are public to anyone with the link. Do not put secrets in one.</p>
</div>

<div style="margin:20px 0;padding:18px 20px;border:1px solid #5a3d12;border-left:4px solid var(--warn);border-radius:10px;background:#2a1d08;">
  <strong style="display:block;margin-bottom:4px;">Watch</strong>
  <p style="margin:0;">A plan at 4 MiB uploads slowly on a phone. Compress screenshots before embedding them.</p>
</div>

<div style="margin:20px 0;padding:18px 20px;border:1px solid #1e5a3f;border-left:4px solid var(--ok);border-radius:10px;background:#0b241a;">
  <strong style="display:block;margin-bottom:4px;">Done</strong>
  <p style="margin:0;">The home page, health route and static files work without the stores.</p>
</div>
```

## Timeline

```html
<ol style="list-style:none;margin:16px 0;padding:0;border-left:2px solid var(--line);">
  <li style="position:relative;padding:0 0 22px 22px;">
    <span style="position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--accent);"></span>
    <strong>Week 1. Private store</strong>
    <p style="margin:4px 0 0;color:var(--muted);font-size:14px;">Delete the public store. Create the private store in LHR1. Upload one plan and read it back.</p>
  </li>
  <li style="position:relative;padding:0 0 22px 22px;">
    <span style="position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--ink);"></span>
    <strong>Week 2. View and cache</strong>
    <p style="margin:4px 0 0;color:var(--muted);font-size:14px;">Serve the plan with the sandbox CSP, prove a HIT, and prove the purge on delete.</p>
  </li>
</ol>
```

## Status pill

```html
<span style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);font:11px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;">
  <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);"></span>
  On track
</span>
```

## Rules that keep a plan safe

- No `<script>`, `<form>`, `<iframe>`, `<object>`, `<embed>` or `<base>`.
- No `<a href>`. Keep the text, drop the link.
- No `<meta http-equiv="refresh">`.
- No `on...` attributes.
- No external `url()` in CSS or SVG. Use `#fragment` or `data:image/` only.
- No external fonts. Use the system stack.
- Keep nesting under 200 levels.
- Keep the file under 4,194,304 bytes. The server rejects the rest.
