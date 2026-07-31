import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workflowSource = fs.readFileSync(
  path.resolve(currentDir, '../tenant-deletion-workflow.ts'),
  'utf8',
);

function guardedBlock(patchId: string): string {
  const start = workflowSource.indexOf(`if (patched('${patchId}')) {`);
  expect(start).toBeGreaterThan(-1);

  const nextPatch = workflowSource.indexOf('if (patched(', start + 1);
  return workflowSource.slice(start, nextPatch === -1 ? undefined : nextPatch);
}

describe('tenant deletion suspension workflow wiring', () => {
  it('T011: suspends tenant activity right after email suspension, before trigger-specific branching', () => {
    const emailSuspendIndex = workflowSource.indexOf(
      'await suspendTenantEmailIngestion(input.tenantId)',
    );
    const tenantSuspendIndex = workflowSource.indexOf(
      'await suspendTenantBackgroundActivity(input.tenantId)',
    );
    const triggerSpecificIndex = workflowSource.indexOf(
      "if (input.triggerSource !== 'stripe_webhook'",
    );

    expect(emailSuspendIndex).toBeGreaterThan(-1);
    expect(tenantSuspendIndex).toBeGreaterThan(emailSuspendIndex);
    expect(tenantSuspendIndex).toBeLessThan(triggerSpecificIndex);
    expect(guardedBlock('tenant-deletion-suspend-tenant-v1')).toContain(
      "state.step = 'suspending_tenant_activity'",
    );
  });

  it('T014: rollback resumes tenant activity after email resume with contained errors', () => {
    const rollbackStart = workflowSource.indexOf('async function handleRollback(');
    const emailResumeIndex = workflowSource.indexOf(
      'await resumeTenantEmailIngestion(tenantId)',
      rollbackStart,
    );
    const tenantResumeIndex = workflowSource.indexOf(
      'await resumeTenantBackgroundActivity(tenantId)',
      rollbackStart,
    );
    const nextRollbackStep = workflowSource.indexOf(
      'await removeClientCanceledTag(tenantId)',
      rollbackStart,
    );

    expect(emailResumeIndex).toBeGreaterThan(rollbackStart);
    expect(tenantResumeIndex).toBeGreaterThan(emailResumeIndex);
    expect(tenantResumeIndex).toBeLessThan(nextRollbackStep);
    expect(guardedBlock('tenant-deletion-resume-tenant-v1')).toContain('catch (tenantResumeError)');
  });

  it('T048: each suspension activity is guarded by its own stable patch marker exactly once', () => {
    const cases = [
      ['tenant-deletion-suspend-tenant-v1', 'suspendTenantBackgroundActivity'],
      ['tenant-deletion-resume-tenant-v1', 'resumeTenantBackgroundActivity'],
    ] as const;

    for (const [patchId, activity] of cases) {
      const block = guardedBlock(patchId);
      expect(block).toContain(`await ${activity}(`);
      expect(workflowSource.match(new RegExp(`await ${activity}\\(`, 'g'))).toHaveLength(1);
    }
  });
});
