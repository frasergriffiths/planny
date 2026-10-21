# Planny plan components

Copy these into a plan HTML file. They are built for planny's viewer: no scripts, no links, no forms, no frames and no external files. Charts are HTML/CSS, or inline SVG when the graphic is fixed size. Images, if you use them, must be `data:image/png`, `jpeg`, `gif`, `webp` or `avif`. Keep the whole file under 4 MiB (4,194,304 bytes).

Never put SVG `<text>` in a chart that stretches: SVG text scales with the viewBox and goes unreadable at one end. Bar charts are CSS rows, line charts are a stretched SVG shape with HTML labels, and only the fixed-size donut keeps SVG text.

The server sanitises every plan anyway. These components are written to survive that pass unchanged, so what you preview is what readers get.

## Shared tokens

Put this once in the plan's `<style>` block. Adjust the accent, keep the contrast.

```html
<style>
  :root {
    /* TOKENS */
    --inset-card: 16px;
    --border-card: 2px;
    --pad-card: 14px;
    --radius-card: 12px;
    --radius-bar: 4px;
    --radius-swatch: 3px;
    --line: #262626;
    --accent: #3291FF;
    --panel: #0a0a0a;
    /* /TOKENS */
    color-scheme: dark;
    --line-strong: #3f3f3f;
    --paper: #000000;
    --ink: #f5f5f5;
    --muted: #a1a1a1;
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
  .page { width: 100%; max-width: 1240px; margin: 0 auto; padding: clamp(20px, 4vw, 52px); }
  .measure { max-width: 70ch; }
  .eyebrow { font-family: var(--mono); font-size: 11px; line-height: 1.3; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  h1 { max-width: 18ch; font-size: clamp(34px, 5.5vw, 64px); line-height: 1.05; letter-spacing: -.03em; text-wrap: balance; }
  h2 { font-size: clamp(22px, 2.8vw, 30px); }
</style>
```

## Cards

Two variants, both with a 16px text inset:

- `.card` - the accent card: transparent, no full border and no radius, a 2px blue left rule, and 14px padding.
- `.card--outline` - the normal card: transparent, a 1px full border in `line`, 12px radius, and 15px padding.
- Add `.card--panel` to `.card--outline` for a `panel` fill.

Headings outside cards use `padding-left: var(--inset-card)`; subheads inside cards use `.eyebrow`, so they do not add a second inset.

```html
<style>
  .card { box-sizing: border-box; background: transparent; border: 0; border-left: var(--border-card) solid var(--accent); border-radius: 0; padding: var(--pad-card); }
  .card--outline { border: 1px solid var(--line); border-radius: var(--radius-card); padding: calc(var(--inset-card) - 1px); }
  .card--panel { background: var(--panel); }
  main > section > h2, aside > section > h3 { padding-left: var(--inset-card); }
</style>
```

## KPI cards

```html
<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
  <div class="card">
    <div class="eyebrow">Week 1</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">1</strong>
    <span style="font-size:12px;color:var(--muted);">milestone complete</span>
  </div>
  <div class="card">
    <div class="eyebrow">Target</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">&lt; 2s</strong>
    <span style="font-size:12px;color:var(--muted);">p95 first view</span>
  </div>
  <div class="card">
    <div class="eyebrow">Cap</div>
    <strong style="display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;">4 MiB</strong>
    <span style="font-size:12px;color:var(--muted);">per plan</span>
  </div>
  <div class="card">
    <div class="eyebrow">Guard</div>
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

## Normal card

Use `.card--outline` for a full-border, rounded card. It has the same 16px text inset.

```html
<div class="card card--outline">
  <div class="eyebrow">Normal card</div>
  <p style="margin:0;">Full border, 12px radius, same text inset.</p>
</div>
```

## Progress bar

```html
<div style="margin:12px 0;">
  <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:13px;">
    <span>Private store cutover</span><span style="color:var(--muted);font-family:var(--mono);">72%</span>
  </div>
  <div style="height:10px;border-radius:var(--radius-bar);background:var(--line);overflow:hidden;">
    <div style="height:100%;width:72%;border-radius:var(--radius-bar);background:var(--accent);"></div>
  </div>
</div>
```

## Stacked budget bar

Use one bar for a small budget split. The total is quiet text above, not a card. The legend stays small.

```html
<p style="margin:0 0 10px;color:var(--muted);font-family:var(--mono);font-size:12px;">$240k <span style="margin-left:6px;color:var(--muted);font-family:var(--sans);font-size:11px;">2027 budget</span></p>
<div role="img" aria-label="2027 budget: coffee 45 percent, packaging 20 percent, marketing 20 percent, operations 15 percent" style="display:flex;height:10px;overflow:hidden;border-radius:var(--radius-bar);background:var(--line);gap:2px;">
  <span style="display:block;height:100%;width:45%;background:#3291FF;" title="Coffee 45%"></span>
  <span style="display:block;height:100%;width:20%;background:#8ab8ff;" title="Packaging 20%"></span>
  <span style="display:block;height:100%;width:20%;background:#5f6368;" title="Marketing 20%"></span>
  <span style="display:block;height:100%;width:15%;background:#3f3f3f;" title="Operations 15%"></span>
</div>
<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:10px;color:var(--muted);font-size:11px;">
  <span><i style="display:inline-block;width:6px;height:6px;border-radius:var(--radius-swatch);background:#3291FF;"></i>Coffee 45%</span>
  <span><i style="display:inline-block;width:6px;height:6px;border-radius:var(--radius-swatch);background:#8ab8ff;"></i>Packaging 20%</span>
  <span><i style="display:inline-block;width:6px;height:6px;border-radius:var(--radius-swatch);background:#5f6368;"></i>Marketing 20%</span>
  <span><i style="display:inline-block;width:6px;height:6px;border-radius:var(--radius-swatch);background:#3f3f3f;"></i>Ops 15%</span>
</div>
```

## CSS bar chart

CSS bars with HTML labels: 12px text in CSS pixels at every width. Replace the series and values. Use one `.fill` per row and keep the chart to a single series.

```html
<div class="chart-card">
  <p class="chart-title">New subscribers by channel</p>
  <div class="hbars" role="img" aria-label="New subscribers by channel: referral 320, bag club 260, market 180, wholesale 140">
    <div class="hbar"><span>Referral</span><div class="bar-track" aria-hidden="true"><div class="fill" style="width:100%"></div></div><span class="val">320</span></div>
    <div class="hbar"><span>Bag club up</span><div class="bar-track" aria-hidden="true"><div class="fill" style="width:81%"></div></div><span class="val">260</span></div>
    <div class="hbar"><span>Market</span><div class="bar-track" aria-hidden="true"><div class="fill" style="width:56%"></div></div><span class="val">180</span></div>
    <div class="hbar"><span>Wholesale</span><div class="bar-track" aria-hidden="true"><div class="fill" style="width:44%"></div></div><span class="val">140</span></div>
  </div>
  <p class="chart-caption">Fictional plan data. Ten channels fit as rows without label collisions.</p>
</div>
<style>
  .chart-card { margin: 16px 0 14px; padding: calc(var(--inset-card) - 1px); border: 1px solid var(--line); border-radius: var(--radius-card); background: transparent; }
  .chart-title { margin: 0 0 12px; font-size: 13px; font-weight: 650; }
  .hbars { display: grid; gap: 2px; }
  .hbar { display: grid; grid-template-columns: minmax(84px, 116px) minmax(0, 1fr) 52px; gap: 10px; align-items: center; padding: 4px 0; font-size: 12px; color: var(--ink); }
  .hbar .bar-track { display: flex; align-items: center; height: 20px; border-radius: var(--radius-bar); background: var(--panel); overflow: hidden; }
  .hbar .fill { display: block; height: 100%; border-radius: var(--radius-bar); background: var(--accent); transform-origin: left; animation: bar-grow .7s ease-out both; }
  .hbar .val { color: var(--muted); font-family: var(--mono); font-size: 12px; text-align: right; white-space: nowrap; }
  .chart-caption { margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .chart-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 0; color: var(--muted); font-size: 12px; }
  .chart-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .chart-legend i { display: inline-block; width: 7px; height: 7px; border-radius: var(--radius-swatch); }
  @keyframes bar-grow { from { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .fill { animation: none; } }
  @media print { .fill { animation: none; } }
  @media (max-width: 700px) {
    .hbar { grid-template-columns: minmax(76px, 96px) minmax(0, 1fr) 48px; }
    .chart-caption { font-size: 12px; }
  }
</style>
```

Keep the widths on a 0-to-max scale of the largest value (largest value = 100%). Put the value in `.val`.

## Line chart with HTML labels

The SVG carries the shape only and stretches with the chart; `vector-effect="non-scaling-stroke"` keeps the stroke at 3px. Every label and value is HTML in fixed CSS pixels, so text never scales with the viewBox. Nine to twelve categories read fine: every second x label hides under 700px.

```html
<div class="chart-card">
  <p class="chart-title">Subscribers, January to September</p>
  <div class="line-chart" role="img" aria-label="Subscribers by month: Jan 180, Feb 260, Mar 360, Apr 480, May 620, Jun 760, Jul 900, Aug 1,060, Sep 1,200">
    <div class="line-plot" aria-hidden="true">
      <div class="gridline" style="top:0"><span class="y-label">1,200</span></div>
      <div class="gridline dim" style="top:25%"><span class="y-label">900</span></div>
      <div class="gridline dim" style="top:50%"><span class="y-label">600</span></div>
      <div class="gridline dim" style="top:75%"><span class="y-label">300</span></div>
      <div class="gridline" style="top:100%"><span class="y-label">0</span></div>
      <svg viewBox="0 0 800 200" preserveAspectRatio="none" fill="none">
        <polyline class="chart-line" vector-effect="non-scaling-stroke" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0" points="0,170 100,163 200,150 300,133 400,110 500,87 600,65 700,42 800,25" stroke="#3291FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    </div>
    <div class="x-labels" aria-hidden="true"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div>
  </div>
  <div class="chart-legend"><span><i style="background:var(--accent)"></i>Subscribers</span></div>
  <p class="chart-caption">Fictional plan data. Labels are HTML, so they stay 11-12px at every width.</p>
</div>
<style>
  .line-chart { position: relative; margin: 4px 0 0; }
  .line-plot { position: relative; height: 200px; margin-left: 40px; }
  .line-plot svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
  .gridline { position: absolute; left: 0; right: 0; height: 1px; background: var(--line); }
  .gridline.dim { background: #1f1f1f; }
  .y-label { position: absolute; right: 100%; transform: translateY(-50%); padding-right: 8px; color: var(--muted); font-family: var(--mono); font-size: 12px; white-space: nowrap; }
  .x-labels { display: grid; margin-left: 40px; color: var(--muted); font-family: var(--mono); font-size: 11px; }
  .x-labels span { padding-top: 8px; text-align: center; white-space: nowrap; }
  .x-labels span:first-child { text-align: left; }
  .x-labels span:last-child { text-align: right; }
  .chart-line { stroke-dasharray: 1; stroke-dashoffset: 0; animation: draw 1.1s ease-out both; }
  @keyframes draw { from { stroke-dashoffset: 1; } }
  @media (prefers-reduced-motion: reduce) { .chart-line { animation: none; } }
  @media print { .chart-line { animation: none; } }
  @media (max-width: 700px) {
    .x-labels span:nth-child(2n) { visibility: hidden; }
    .line-plot, .x-labels { margin-left: 34px; }
    .line-plot { height: 180px; }
  }
</style>
```

Turn each point into an x fraction (`0` to `800`) and a y fraction on the 0-to-max scale: y = `200 - (value / max) × 200`, so a 1,200 value at top scale sits on y 0, and 0 sits on y 200. The first sample row shows the arithmetic. Give the `.line-chart` wrapper `role="img"` and the full `aria-label`; the plot and labels are decorative.

## Inline SVG donut

`pathLength="1"` turns the ring into a 0 to 1 scale. For 78 percent use `stroke-dasharray=".78 1"` and `stroke-dashoffset="0"`. The donut is fixed size, so its SVG `<text>` stays legible; donut only — never put SVG `<text>` in charts that stretch.

```html
<div style="display:flex;align-items:center;gap:16px;">
  <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="Confidence 78 percent">
    <circle cx="48" cy="48" r="40" fill="none" stroke="#262626" stroke-width="10"></circle>
    <circle class="donut-seg" pathLength="1" cx="48" cy="48" r="40" fill="none" stroke="#3291FF" stroke-width="10" stroke-linecap="round" stroke-dasharray=".78 1" stroke-dashoffset="0" transform="rotate(-90 48 48)"><title>Confidence: 78 percent</title></circle>
    <text x="48" y="54" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="700" fill="#f5f5f5">78%</text>
  </svg>
  <p style="margin:0;font-size:13px;color:var(--muted);">Two unknowns remain. Both have owners and dates.</p>
</div>
```

## Motion and accessibility

Keep the final state in the markup and animate with CSS only. The line and donut use `pathLength="1"`, so the dash values are fractions. CSS bars grow from the left. Print and reduced motion show the final state.

Add `class="chart-line"` to the SVG line, `class="fill"` to each CSS bar, and `class="donut-seg"` to the donut arc. Put the role, an `aria-label` that includes the figures, on the chart wrapper, and `aria-hidden="true"` on the plot, so screen readers hear one complete description.

```html
<style>
  .chart-line { stroke-dasharray: 1; stroke-dashoffset: 0; animation: draw 1.1s ease-out both; }
  .fill { transform-origin: left; animation: bar-grow .7s ease-out both; }
  @keyframes draw { from { stroke-dashoffset: 1; } }
  @keyframes bar-grow { from { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .chart-line, .fill, .donut-seg, .stacked span { animation: none; }
  }
  @media print {
    .chart-line, .fill, .donut-seg, .stacked span { animation: none; }
  }
</style>
```

## CSS grid Gantt

Wrap the Gantt in `.gantt-wrap` and give the inner `.gantt` a `min-width` (650px desktop), so phones scroll the track horizontally instead of squeezing eight columns. The label column is 150px desktop and 100px below 700px.

```html
<div class="gantt-wrap">
  <div class="gantt" style="min-width:650px;">
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;margin-bottom:6px;color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;">
      <div>Workstream</div><div>W1</div><div>W2</div><div>W3</div><div>W4</div><div>W5</div><div>W6</div><div>W7</div><div>W8</div>
    </div>
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
      <div style="font-weight:650;">Store + upload</div>
      <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:26px;">
        <div style="grid-row:1;grid-column:1 / span 2;display:flex;align-items:center;padding:0 9px;border-radius:var(--radius-bar);background:var(--accent);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">201, delete key, 4 MiB</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
      <div style="font-weight:650;">View + cache</div>
      <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:26px;">
        <div style="grid-row:1;grid-column:2 / span 3;display:flex;align-items:center;padding:0 9px;border-radius:var(--radius-bar);background:var(--line-strong);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">200, TTL, purge</div>
      </div>
      <p class="gantt-note">200, TTL, purge</p>
    </div>
  </div>
</div>
<style>
  .gantt-wrap { overflow-x: auto; margin: 16px 0 24px; -webkit-overflow-scrolling: touch; }
  .gantt-note { display: none; }
  @media (max-width: 700px) {
    .gantt { min-width: 0; }
    .gantt-head { display: none; }
    .gantt-row { grid-template-columns: minmax(0, 1fr); margin-bottom: 12px; }
    .gantt-row .label { padding: 0 0 4px; color: var(--muted); font-size: 12px; font-weight: 650; }
    .track {
      grid-column: 1 / -1;
      min-height: 16px;
      background-image: repeating-linear-gradient(to right, var(--line) 0, var(--line) 1px, transparent 1px calc(100% / 8));
    }
    .gantt-row .bar { height: 16px; padding: 0; font-size: 0; }
    .gantt-note { display: block; margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
  }
</style>
```

Under 700px the Gantt stacks: the label sits above a full-width track with subtle week dividers. The bar text is hidden with `font-size: 0` and the same words appear in a `.gantt-note` below the track, so nothing is cut off. Desktop keeps the text inside the bars and the scrollable wrapper for plans with more weeks.

## Decision matrix

Wrap any table wider than one phone screen in `.table-wrap` (`overflow-x: auto`), so it scrolls inside its region instead of stretching the page.

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
<svg viewBox="0 0 720 300" role="img" aria-label="Agent to planny to Blob" style="display:block;width:100%;height:auto;border:0;border-left:var(--border-card) solid var(--accent);border-radius:0;background:transparent;">
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#f5f5f5">
    <rect x="30" y="110" width="150" height="70" fill="#0a0a0a" stroke="#2b4a7a"></rect>
    <text x="105" y="140" text-anchor="middle" font-weight="700">Agent</text>
    <text x="105" y="160" text-anchor="middle" fill="#a1a1a1">one HTML file</text>
    <rect x="285" y="95" width="170" height="100" fill="#3291FF"></rect>
    <text x="370" y="130" text-anchor="middle" fill="#0a0a0a" font-weight="700">planny</text>
    <text x="370" y="152" text-anchor="middle" fill="#dbeafe">sanitise, store, link</text>
    <rect x="555" y="45" width="140" height="70" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="75" text-anchor="middle" font-weight="700">Blob</text>
    <text x="625" y="95" text-anchor="middle" fill="#a1a1a1">private HTML</text>
    <rect x="555" y="185" width="140" height="70" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="215" text-anchor="middle" font-weight="700">Blob state</text>
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
<div class="card" style="margin:20px 0;">
  <strong style="display:block;margin-bottom:4px;">Note</strong>
  <p style="margin:0;">Plans are public to anyone with the link. Do not put secrets in one.</p>
</div>

<div class="card" style="margin:20px 0;--accent:var(--warn);">
  <strong style="display:block;margin-bottom:4px;">Watch</strong>
  <p style="margin:0;">A plan at 4 MiB uploads slowly on a phone. Compress screenshots before embedding them.</p>
</div>

<div class="card" style="margin:20px 0;--accent:var(--ok);">
  <strong style="display:block;margin-bottom:4px;">Done</strong>
  <p style="margin:0;">The static pages work without the stores.</p>
</div>
```

## Timeline

The default schedule view. Use a vertical line with one dot per milestone, four to six items in date order. Each item has a short date or week label, a bold title and one line of detail. It reads the same at 390px and 1440px with no horizontal scroll.

```html
<ol class="timeline" aria-label="Milestones">
  <li><span class="dot" aria-hidden="true"></span><span class="when">14 Nov 2026</span><strong>Lease signed</strong><p>Dev signs and pays the deposit.</p></li>
  <li><span class="dot" aria-hidden="true"></span><span class="when">28 Nov 2026</span><strong>Electrician and wheels booked</strong><p>Mara confirms both orders.</p></li>
  <li><span class="dot" aria-hidden="true"></span><span class="when">09 Jan 2027</span><strong>Fit-out complete</strong><p>Sink tested and six wheels wired.</p></li>
</ol>
<style>
  .timeline { list-style: none; margin: 18px 0 24px; padding: 0 0 0 2px; border-left: 2px solid var(--line); }
  .timeline li { position: relative; padding: 0 0 22px 22px; break-inside: avoid; }
  .timeline li:last-child { padding-bottom: 0; }
  .timeline .dot { position: absolute; left: -7px; top: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
  .timeline .when { display: block; color: var(--muted); font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .timeline strong { display: block; margin: 3px 0 2px; font-size: 15px; line-height: 1.35; }
  .timeline p { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
  @media (max-width: 420px) { .timeline li { padding-left: 18px; } }
</style>
```

## CSS grid Gantt

Optional advanced component. The default templates and the sample use the vertical timeline above. Reach for a Gantt only when a plan needs overlapping workstreams across many weeks, and expect it to scroll on a phone.

Wrap the Gantt in `.gantt-wrap` and give the inner `.gantt` a `min-width` (650px desktop), so phones scroll the track horizontally instead of squeezing eight columns. The label column is 150px desktop and 100px below 700px.

```html
<div class="gantt-wrap">
  <div class="gantt" style="min-width:650px;">
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;margin-bottom:6px;color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;">
      <div>Workstream</div><div>W1</div><div>W2</div><div>W3</div><div>W4</div><div>W5</div><div>W6</div><div>W7</div><div>W8</div>
    </div>
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
      <div style="font-weight:650;">Store + upload</div>
      <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:26px;">
        <div style="grid-row:1;grid-column:1 / span 2;display:flex;align-items:center;padding:0 9px;border-radius:var(--radius-bar);background:var(--accent);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">201, delete key, 4 MiB</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:150px repeat(8,minmax(0,1fr));gap:6px;align-items:center;margin-bottom:6px;">
      <div style="font-weight:650;">View + cache</div>
      <div style="grid-column:2 / -1;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;min-height:26px;">
        <div style="grid-row:1;grid-column:2 / span 3;display:flex;align-items:center;padding:0 9px;border-radius:var(--radius-bar);background:var(--line-strong);color:#fff;font-size:11px;white-space:nowrap;overflow:hidden;">200, TTL, purge</div>
      </div>
      <p class="gantt-note">200, TTL, purge</p>
    </div>
  </div>
</div>
<style>
  .gantt-wrap { overflow-x: auto; margin: 16px 0 24px; -webkit-overflow-scrolling: touch; }
  .gantt-note { display: none; }
  @media (max-width: 700px) {
    .gantt { min-width: 0; }
    .gantt-head { display: none; }
    .gantt-row { grid-template-columns: minmax(0, 1fr); margin-bottom: 12px; }
    .gantt-row .label { padding: 0 0 4px; color: var(--muted); font-size: 12px; font-weight: 650; }
    .track {
      grid-column: 1 / -1;
      min-height: 16px;
      background-image: repeating-linear-gradient(to right, var(--line) 0, var(--line) 1px, transparent 1px calc(100% / 8));
    }
    .gantt-row .bar { height: 16px; padding: 0; font-size: 0; }
    .gantt-note { display: block; margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
  }
</style>
```

Under 700px the Gantt stacks: the label sits above a full-width track with subtle week dividers. The bar text is hidden with `font-size: 0` and the same words appear in a `.gantt-note` below the track, so nothing is cut off. Desktop keeps the text inside the bars and the scrollable wrapper for plans with more weeks.

## Decision matrix

Wrap any table wider than one phone screen in `.table-wrap` (`overflow-x: auto`), so it scrolls inside its region instead of stretching the page.

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
<svg viewBox="0 0 720 300" role="img" aria-label="Agent to planny to Blob" style="display:block;width:100%;height:auto;border:0;border-left:var(--border-card) solid var(--accent);border-radius:0;background:transparent;">
  <g font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="#f5f5f5">
    <rect x="30" y="110" width="150" height="70" fill="#0a0a0a" stroke="#2b4a7a"></rect>
    <text x="105" y="140" text-anchor="middle" font-weight="700">Agent</text>
    <text x="105" y="160" text-anchor="middle" fill="#a1a1a1">one HTML file</text>
    <rect x="285" y="95" width="170" height="100" fill="#3291FF"></rect>
    <text x="370" y="130" text-anchor="middle" fill="#0a0a0a" font-weight="700">planny</text>
    <text x="370" y="152" text-anchor="middle" fill="#dbeafe">sanitise, store, link</text>
    <rect x="555" y="45" width="140" height="70" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="75" text-anchor="middle" font-weight="700">Blob</text>
    <text x="625" y="95" text-anchor="middle" fill="#a1a1a1">private HTML</text>
    <rect x="555" y="185" width="140" height="70" fill="#0a0a0a" stroke="#262626"></rect>
    <text x="625" y="215" text-anchor="middle" font-weight="700">Blob state</text>
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
<div class="card" style="margin:20px 0;">
  <strong style="display:block;margin-bottom:4px;">Note</strong>
  <p style="margin:0;">Plans are public to anyone with the link. Do not put secrets in one.</p>
</div>

<div class="card" style="margin:20px 0;--accent:var(--warn);">
  <strong style="display:block;margin-bottom:4px;">Watch</strong>
  <p style="margin:0;">A plan at 4 MiB uploads slowly on a phone. Compress screenshots before embedding them.</p>
</div>

<div class="card" style="margin:20px 0;--accent:var(--ok);">
  <strong style="display:block;margin-bottom:4px;">Done</strong>
  <p style="margin:0;">The static pages work without the stores.</p>
</div>
```

## Timeline

```html
<ol style="list-style:none;margin:16px 0;padding:0;border-left:2px solid var(--line);">
  <li style="position:relative;padding:0 0 22px 22px;">
    <span style="position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--accent);"></span>
    <strong>Week 1. Production store</strong>
    <p style="margin:4px 0 0;color:var(--muted);font-size:14px;">Create the production store, upload one plan, and read it back.</p>
  </li>
  <li style="position:relative;padding:0 0 22px 22px;">
    <span style="position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--ink);"></span>
    <strong>Week 2. View and cache</strong>
    <p style="margin:4px 0 0;color:var(--muted);font-size:14px;">Serve the plan with the sandbox CSP, prove a HIT, and prove the purge on delete.</p>
  </li>
</ol>
```

## Code blocks with a copy button

Wrap a code sample in `.code-block`. The optional `.code-head` carries the language or file label. planny adds an icon-only Copy button to every `.code-block` in the viewer. It shows a check for 1.5 seconds after a copy and announces "Copied" to screen readers. Do not add your own button, script or event handler.

```html
<div class="code-block">
  <div class="code-head"><span>deploy.sh</span></div>
  <pre><code><span class="tok-comment"># one command, no prompts</span>
<span class="tok-fn">node</span> scripts/publish.mjs plan.html <span class="tok-punct">\</span>
  <span class="tok-key">--name</span> <span class="tok-string">"Q4 rollout"</span> <span class="tok-key">--duration</span> <span class="tok-number">90d</span></code></pre>
</div>
```

Highlight statically by wrapping tokens in spans. There is no runtime highlighter and no external library, so the markup is the highlight.

| Class | Use for |
| --- | --- |
| `.tok-key` | object keys, flags, keywords |
| `.tok-string` | quoted text |
| `.tok-number` | numbers and sizes |
| `.tok-bool` | true, false, null |
| `.tok-comment` | comments |
| `.tok-fn` | function or command names |
| `.tok-punct` | brackets, commas, operators |
| `.tok-tag` | HTML or XML tags |
| `.tok-attr` | attribute names |

Keep the sample short. The block scrolls horizontally on its own, so long lines do not widen the page. Do not put a real secret in a plan.

## Heroicons

`reference/icons.md` lists 18 Heroicons 24px outline SVGs (user, users, calendar, clock, chart-bar, document-text, code-bracket, link, shield-check, exclamation-triangle, check-circle, arrow-trending-up, briefcase, currency-dollar, map, flag, light-bulb, clipboard-document-check). Copy one inline, keep `stroke="currentColor"` and `stroke-width="1.5"`, and set `aria-hidden="true"` because the adjacent heading carries the meaning. External icon files are stripped.

## Rules that keep a plan safe

- No `<script>`, `<form>`, `<iframe>`, `<object>`, `<embed>` or `<base>`.
- No `<a href>`. Keep the text, drop the link.
- No `<meta http-equiv="refresh">`.
- No `on...` attributes.
- No external `url()` in CSS or SVG. Use `#fragment` or `data:image/` only.
- No external fonts. Use the system stack.
- Keep nesting under 200 levels.
- Keep the file under 4,194,304 bytes. The server rejects the rest.
