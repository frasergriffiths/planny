#!/usr/bin/env bun
// Refuses a push if any pushed commit was authored or committed by an address outside the
// allowlist. Run by .githooks/pre-push. Vercel blocks commits it can't match to GitHub, so an
// invented address must never reach the remote. Git passes "<local ref> <local sha> <remote ref>
// <remote sha>" lines on stdin, one per ref being pushed, including tags.
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'frasergriffiths@users.noreply.github.com',
  'steven@planny.invalid',
]);

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  const input = await new Response(Bun.stdin.stream()).text();
  const lines = input
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2);
  // Tags don't deploy and may point at old snapshots, so only branch pushes are checked.
  const branchLines = lines.filter((parts) => !(parts[0] ?? '').includes('/tags/') && !(parts[2] ?? '').includes('/tags/'));
  const shas = branchLines
    .map((parts) => parts[1] ?? '')
    .filter((sha) => /^[0-9a-f]{40}$/.test(sha));
  // Only fall back to HEAD when the hook got no input at all, never when every line was a tag.
  if (lines.length === 0) shas.push(git(['rev-parse', 'HEAD']));

  const bad: string[] = [];
  for (const sha of shas) {
    const output = git(['log', '--format=%H%x00%ae%x00%ce', '-1', sha]);
    const [commit, author, committer] = output.split('\u0000');
    if (!commit || !author || !committer) continue;
    if (!ALLOWED.has(author) || !ALLOWED.has(committer)) bad.push(`${commit.slice(0, 7)} ${author} / ${committer}`);
  }
  if (bad.length > 0) {
    console.error('Pre-push refused: commit identity outside the allowlist.');
    for (const line of bad) console.error(`  ${line}`);
    console.error(`Allowed: ${[...ALLOWED].join(', ')}`);
    process.exit(1);
  }
  console.log(`Pre-push identity check passed for ${shas.length} ref(s).`);
}

main().catch((error: unknown) => {
  console.error('Pre-push identity check could not run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
