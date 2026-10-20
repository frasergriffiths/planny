// Reads the plan from `vercel project inspect --json` and refuses anything it can't read.
// Fail closed: an unknown plan, a missing field or a Hobby project all stop the deploy.
export type Plan = 'pro' | 'hobby' | 'unknown';

export function planFromInspect(value: unknown): Plan {
  if (typeof value !== 'object' || value === null) return 'unknown';
  const record = value as Record<string, unknown>;
  const candidates = [record.plan, record.planName, (record.project as Record<string, unknown> | undefined)?.plan];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.toLowerCase() === 'pro') return 'pro';
    if (typeof candidate === 'string' && candidate.toLowerCase() === 'hobby') return 'hobby';
  }
  return 'unknown';
}

export function assertProPlan(value: unknown): void {
  const plan = planFromInspect(value);
  if (plan !== 'pro') {
    throw new Error(`Refusing to deploy: the Vercel project plan is ${plan}, not pro. This helper only deploys Pro projects; use \`vercel --prod\` directly if you accept the Hobby limits.`);
  }
}

// The manual deploy script targets production, so it must run from main.
export function assertMainBranch(branch: string): void {
  if (branch.trim() !== 'main') {
    throw new Error(`Refusing to deploy: the checked-out branch is ${branch.trim() || 'unknown'}, not main. Production deploys come from main only.`);
  }
}
