import { beforeEach, describe, expect, it } from 'vitest';
import {
  WORKFLOW_SIMULATE_TENANT_POINTS,
  WORKFLOW_SIMULATE_USER_POINTS,
  WorkflowSimulationRateLimitError,
  consumeWorkflowSimulationQuota,
  resetWorkflowSimulationRateLimits,
} from './workflowSimulationRateLimit';
import { getExpressionAdmissionStats, resetExpressionAdmission } from '../runtime/expressionEngine';

describe('workflow simulation rate limits', () => {
  beforeEach(() => {
    resetWorkflowSimulationRateLimits();
    resetExpressionAdmission({ maxConcurrency: 2, queueTimeoutMs: 20 });
  });

  it('sizes the user bucket below the tenant bucket', () => {
    expect(WORKFLOW_SIMULATE_USER_POINTS).toBeLessThan(WORKFLOW_SIMULATE_TENANT_POINTS);
  });

  it('rejects the (bucket+1)th call for one user, with retryAfterSeconds and without touching a slot', async () => {
    for (let i = 0; i < WORKFLOW_SIMULATE_USER_POINTS; i += 1) {
      await consumeWorkflowSimulationQuota({ tenant: 't1', userId: 'u1', action: 'simulate' });
    }
    const rejection = await consumeWorkflowSimulationQuota({ tenant: 't1', userId: 'u1', action: 'simulate' }).catch((e) => e);
    expect(rejection).toBeInstanceOf(WorkflowSimulationRateLimitError);
    expect(rejection).toMatchObject({ status: 429, scope: 'user' });
    expect(rejection.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    // Admission was never involved: no slot taken, none queued, only the rate-limit counter moved.
    expect(getExpressionAdmissionStats()).toMatchObject({ active: 0, queueDepth: 0, acquired: 0, rateLimited: 1 });

    // Another user in the same tenant is unaffected.
    await expect(consumeWorkflowSimulationQuota({ tenant: 't1', userId: 'u2', action: 'simulate' })).resolves.toBeUndefined();
  });

  it('rejects the (bucket+1)th call for a tenant across different users', async () => {
    for (let i = 0; i < WORKFLOW_SIMULATE_TENANT_POINTS; i += 1) {
      await consumeWorkflowSimulationQuota({ tenant: 't2', userId: `user-${i}`, action: 'simulate' });
    }
    const rejection = await consumeWorkflowSimulationQuota({ tenant: 't2', userId: 'fresh-user', action: 'simulate' }).catch((e) => e);
    expect(rejection).toBeInstanceOf(WorkflowSimulationRateLimitError);
    expect(rejection.scope).toBe('tenant');
    expect(getExpressionAdmissionStats()).toMatchObject({ active: 0, acquired: 0 });
    // A different tenant is unaffected.
    await expect(consumeWorkflowSimulationQuota({ tenant: 't3', userId: 'u', action: 'simulate' })).resolves.toBeUndefined();
  });

  it('a throttled user does not burn tenant tokens', async () => {
    for (let i = 0; i < WORKFLOW_SIMULATE_USER_POINTS + 5; i += 1) {
      await consumeWorkflowSimulationQuota({ tenant: 't4', userId: 'u1', action: 'simulate' }).catch(() => undefined);
    }
    // Tenant spent exactly USER_POINTS; the remainder is still available to others.
    for (let i = 0; i < WORKFLOW_SIMULATE_TENANT_POINTS - WORKFLOW_SIMULATE_USER_POINTS; i += 1) {
      await consumeWorkflowSimulationQuota({ tenant: 't4', userId: `other-${i}`, action: 'simulate' });
    }
  });
});
