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
    throw new Error(`Refusing to deploy: the Vercel project plan is ${plan}, not pro. A Hobby project can't run lhr1 functions or carry public traffic.`);
  }
}
