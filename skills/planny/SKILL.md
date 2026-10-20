---
name: planny
description: Publish plans, reports, roadmaps and HTML one-pagers as shareable links, with the delete key kept in a 0600 file. Ships project, launch, research and decision templates.
---

# planny

Use this when someone wants a plan, report, roadmap or one-pager published as a link.

- Pick a template first. `template.html` is the project plan. `templates/launch-plan.html`, `templates/research-plan.html` and `templates/decision-plan.html` cover a launch, a research study and a decision. Every template has the same spine: Who, Why, What, When.
- Read `reference/unslop.md` before writing a plan and apply it to every visible word: titles, lede, section copy, table cells and labels. If the standalone unslop skill is installed, use it as well; the bundled rules are the portable fallback.
- `scripts/publish.mjs` is the only publish path. It checks size (4 MiB), UTF-8, warns about markup the sanitiser removes, posts the raw HTML, and writes the key to `~/.planny/<id>.json` with mode 0600 in a 0700 folder. It never prints the key.
- `scripts/delete.mjs` is the only delete path. It reads that file, sends the DELETE, prints only the status, and removes the file on 200 or 410.
- `reference/components.md` has charts, Gantt, decision matrix, risk register and KPI snippets. `reference/errors.md` lists the status codes.

Rules: no scripts, links, forms, frames, external files or external fonts; CSS, inline SVG, tables and `data:image/` images are fine. Name 1 to 120 characters, duration `h/d/w/m/y` from 1 hour to 100 years.

## Workflow

1. Choose the template that fits: project, launch, research or decision.
2. Read `reference/unslop.md` and edit every visible word to its rules.
3. Keep the Who, Why, What, When order. Replace the sample content with the real plan.
4. Publish.

## Install

```
npx skills add frasergriffiths/planny --skill planny
```

## Use

Resolve the directory that contains this SKILL.md and run:

```
node <skill-dir>/scripts/publish.mjs plan.html --name "Q4 rollout" --duration 90d
```

The script posts to `https://use-planny.vercel.app` by default. Set `PLANNY_URL` or pass `--base` to publish to a self-hosted instance. Manual Kuvo/OpenClaw install: `./install.sh` adds the `/planny` command and makes the scripts executable.
