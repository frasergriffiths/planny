#!/usr/bin/env bun
// Build public/sample/index.html from the template's head and stylesheet plus the sample body.
// The sample is not a second copy of the plan CSS: it inherits the template's token block.
//   bun run scripts/generate-sample.ts            write the sample
//   bun run scripts/generate-sample.ts --check    fail if the sample is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const templatePath = join(root, 'skills', 'planny', 'template.html');
const bodyPath = join(root, 'public', 'sample', 'body.html');
const samplePath = join(root, 'public', 'sample', 'index.html');
const title = 'Harbor Coffee Roasters: 2027 subscription plan';

const template = readFileSync(templatePath, 'utf8');
const body = readFileSync(bodyPath, 'utf8').trim();
if (/<\/?body\b/i.test(body)) {
  console.error('public/sample/body.html must not contain body tags.');
  process.exit(1);
}
if (!/<title>[^<]*<\/title>/.test(template)) {
  console.error('skills/planny/template.html has no title.');
  process.exit(1);
}
if (!/<body>\n[\s\S]*?\n<\/body>/.test(template)) {
  console.error('skills/planny/template.html has no body.');
  process.exit(1);
}

const sample = template
  .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  .replace(/<!--\n  planny plan template\.[\s\S]*?-->/, `<!--
  planny sample plan.

  A fictional plan for the home CTA. It uses the dark planny template and is
  safe for planny:
  no scripts, links, forms, frames or external files. Charts are inline
  SVG or CSS. Fonts are the system stack. Images, if you add any, must be
  data:image/png, jpeg, gif, webp or avif. Keep the file under 4 MiB.

  The plan is public to anyone with the link. Do not put secrets in it.
-->`)
  .replace(/<body>\n[\s\S]*?\n<\/body>/, `<body>\n${body}\n</body>`);

const current = readFileSync(samplePath, 'utf8');
const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown[0]}`);
  process.exit(1);
}
if (current === sample) {
  console.log('sample up to date');
} else if (check) {
  console.error(`sample out of date: ${samplePath}`);
  process.exit(1);
} else {
  writeFileSync(samplePath, sample);
  console.log(`wrote ${samplePath}`);
}
