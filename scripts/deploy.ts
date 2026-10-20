#!/usr/bin/env bun
// Deploys to production only when the checked-out branch is main and the project's plan reads
// back as Pro. Fails closed when the CLI isn't logged in or the plan can't be read, rather than
// shipping to iad1 on Hobby.
//   bun run scripts/deploy.ts [--prod]
import { execFileSync } from 'node:child_process';
import { assertMainBranch, assertProPlan, planFromInspect } from '../src/deploy-guard.js';

function run(args: string[]): string {
  return execFileSync('bunx', ['vercel@latest', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });

try {
  assertMainBranch(branch);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

try {
  run(['whoami']);
} catch {
  console.error('Refusing to deploy: the Vercel CLI is not logged in here. Run bunx vercel login or set VERCEL_TOKEN.');
  process.exit(1);
}

let inspect: unknown;
try {
  inspect = JSON.parse(run(['project', 'inspect', '--json']));
} catch (error) {
  console.error('Refusing to deploy: could not read the Vercel project plan.', error instanceof Error ? error.message : error);
  process.exit(1);
}

try {
  assertProPlan(inspect);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log(`Vercel plan: ${planFromInspect(inspect)}. Deploying.`);
const deploy = JSON.parse(run(['deploy', '--prod', '--yes', '--json']));
console.log(JSON.stringify(deploy, null, 2));
