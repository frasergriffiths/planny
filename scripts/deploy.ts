#!/usr/bin/env bun
// Deploys to production only when the project's plan reads back as Pro. Fails closed when the
// CLI isn't logged in or the plan can't be read, rather than shipping to iad1 on Hobby.
//   bun run scripts/deploy.ts [--prod]
import { execFileSync } from 'node:child_process';
import { assertProPlan, planFromInspect } from '../src/deploy-guard.js';

function run(args: string[]): string {
  return execFileSync('npx', ['--yes', 'vercel@latest', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  run(['whoami']);
} catch {
  console.error('Refusing to deploy: the Vercel CLI is not logged in here. Run npx vercel login or set VERCEL_TOKEN.');
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
