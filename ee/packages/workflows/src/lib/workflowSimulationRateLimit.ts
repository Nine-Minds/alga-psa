import { RateLimiterMemory, type RateLimiterRes } from 'rate-limiter-flexible';
import { reportExpressionAdmissionEvent } from '../runtime/expressionEngine';

/**
 * Rate limits for the draft-simulation API. These run BEFORE the expression
 * evaluation slot is requested (see expressionAdmission.ts), so a throttled
 * caller never occupies or queues for a slot.
 *
 * Two buckets per call: one per user and one per tenant. The tenant bucket
 * keeps the pre-existing WORKFLOW_SIMULATE_RATE_LIMIT_* configuration; the user
 * bucket is half of it, so one user cannot spend a whole tenant's allowance.
 */
const DEFAULT_POINTS = 60;
const DEFAULT_DURATION_SECONDS = 60;

const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

const tenantPoints = finiteOr(Number(process.env.WORKFLOW_SIMULATE_RATE_LIMIT_POINTS ?? DEFAULT_POINTS), DEFAULT_POINTS);
const durationSeconds = finiteOr(
  Number(process.env.WORKFLOW_SIMULATE_RATE_LIMIT_DURATION ?? DEFAULT_DURATION_SECONDS),
  DEFAULT_DURATION_SECONDS
);

export const WORKFLOW_SIMULATE_TENANT_POINTS = tenantPoints;
export const WORKFLOW_SIMULATE_USER_POINTS = Math.max(1, Math.floor(tenantPoints / 2));

let tenantLimiter = new RateLimiterMemory({ points: WORKFLOW_SIMULATE_TENANT_POINTS, duration: durationSeconds });
let userLimiter = new RateLimiterMemory({ points: WORKFLOW_SIMULATE_USER_POINTS, duration: durationSeconds });

export class WorkflowSimulationRateLimitError extends Error {
  readonly status = 429;
  constructor(
    readonly scope: 'tenant' | 'user',
    readonly retryAfterSeconds: number
  ) {
    super(scope === 'user' ? 'Workflow simulation rate limit exceeded for this user' : 'Workflow simulation rate limit exceeded');
    this.name = 'WorkflowSimulationRateLimitError';
  }
}

async function consume(limiter: RateLimiterMemory, key: string, scope: 'tenant' | 'user', action: string): Promise<void> {
  try {
    await limiter.consume(key);
  } catch (rejection) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((rejection as Partial<RateLimiterRes>)?.msBeforeNext ?? 1000) / 1000));
    reportExpressionAdmissionEvent({ type: 'rate_limited', scope, action, retryAfterSeconds });
    throw new WorkflowSimulationRateLimitError(scope, retryAfterSeconds);
  }
}

/** User bucket first, so a throttled user does not also burn the tenant's allowance. */
export async function consumeWorkflowSimulationQuota(args: { tenant: string; userId?: string | null; action: string }): Promise<void> {
  if (args.userId) await consume(userLimiter, `${args.tenant}:${args.userId}`, 'user', args.action);
  await consume(tenantLimiter, args.tenant, 'tenant', args.action);
}

/** Test support. */
export function resetWorkflowSimulationRateLimits(): void {
  tenantLimiter = new RateLimiterMemory({ points: WORKFLOW_SIMULATE_TENANT_POINTS, duration: durationSeconds });
  userLimiter = new RateLimiterMemory({ points: WORKFLOW_SIMULATE_USER_POINTS, duration: durationSeconds });
}
