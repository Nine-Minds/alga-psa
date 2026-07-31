import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../../../..');
const workflowSource = fs.readFileSync(
  path.resolve(currentDir, '../tenant-deletion-workflow.ts'),
  'utf8',
);
const activitySource = fs.readFileSync(
  path.join(repoRoot, 'ee/temporal-workflows/src/activities/tenant-email-ingestion-activities.ts'),
  'utf8',
);
const microsoftHandlerSource = fs.readFileSync(
  path.join(
    repoRoot,
    'packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts',
  ),
  'utf8',
);
const processorSource = fs.readFileSync(
  path.join(repoRoot, 'shared/services/email/unifiedInboundEmailQueueJobProcessor.ts'),
  'utf8',
);
const lifecycleSource = fs.readFileSync(
  path.join(repoRoot, 'shared/services/email/EmailProviderLifecycleService.ts'),
  'utf8',
);

function guardedBlock(patchId: string): string {
  const start = workflowSource.indexOf(`if (patched('${patchId}')) {`);
  expect(start).toBeGreaterThan(-1);

  const nextPatch = workflowSource.indexOf('if (patched(', start + 1);
  return workflowSource.slice(start, nextPatch === -1 ? undefined : nextPatch);
}

describe('tenant deletion email-ingestion workflow wiring', () => {
  it('suspends ingestion immediately after user deactivation for every trigger source', () => {
    const deactivateIndex = workflowSource.indexOf(
      'await deactivateAllTenantUsers(input.tenantId)',
    );
    const suspendIndex = workflowSource.indexOf(
      'await suspendTenantEmailIngestion(input.tenantId)',
    );
    const triggerSpecificIndex = workflowSource.indexOf(
      "if (input.triggerSource !== 'stripe_webhook'",
    );

    expect(deactivateIndex).toBeGreaterThan(-1);
    expect(suspendIndex).toBeGreaterThan(deactivateIndex);
    expect(suspendIndex).toBeLessThan(triggerSpecificIndex);
  });

  it('resumes cancellation-owned pauses after users reactivate without blocking rollback', () => {
    const rollbackStart = workflowSource.indexOf('async function handleRollback(');
    const reactivateIndex = workflowSource.indexOf(
      'await reactivateTenantUsers(tenantId)',
      rollbackStart,
    );
    const resumeIndex = workflowSource.indexOf(
      'await resumeTenantEmailIngestion(tenantId)',
      rollbackStart,
    );
    const nextRollbackStep = workflowSource.indexOf(
      'await removeClientCanceledTag(tenantId)',
      rollbackStart,
    );

    expect(reactivateIndex).toBeGreaterThan(rollbackStart);
    expect(resumeIndex).toBeGreaterThan(reactivateIndex);
    expect(resumeIndex).toBeLessThan(nextRollbackStep);
    expect(workflowSource.slice(resumeIndex, nextRollbackStep)).toContain('catch (emailResumeError)');
  });

  it('runs final remote teardown before deleting tenant email tables', () => {
    const teardownIndex = workflowSource.indexOf(
      'await teardownTenantEmailIngestion(input.tenantId)',
    );
    const deleteIndex = workflowSource.indexOf(
      'await deleteTenantData(input.tenantId, deletionId)',
    );

    expect(teardownIndex).toBeGreaterThan(-1);
    expect(teardownIndex).toBeLessThan(deleteIndex);
    expect(workflowSource.slice(teardownIndex, deleteIndex)).toContain(
      'catch (emailTeardownError)',
    );
  });

  it('guards every added activity call with a stable Temporal patch marker', () => {
    const cases = [
      ['tenant-deletion-pause-inbound-email-v1', 'suspendTenantEmailIngestion'],
      ['tenant-deletion-final-email-teardown-v1', 'teardownTenantEmailIngestion'],
      ['tenant-deletion-resume-inbound-email-v1', 'resumeTenantEmailIngestion'],
    ] as const;

    for (const [patchId, activity] of cases) {
      const block = guardedBlock(patchId);
      expect(block).toContain(`await ${activity}(`);
      expect(workflowSource.match(new RegExp(`await ${activity}\\(`, 'g'))).toHaveLength(1);
    }
  });

  it('connects cancellation suspension through both Microsoft inbound defenses', () => {
    expect(activitySource).toContain(".where({ is_active: true })");
    expect(activitySource).toContain(".whereNull('inbound_paused_at')");
    expect(activitySource).toContain("'tenant_cancelled'");
    expect(microsoftHandlerSource).toContain(".andWhere('ep.is_active', true)");
    expect(microsoftHandlerSource).toContain(".whereNull('ep.inbound_paused_at')");
    expect(processorSource).toContain("if (!provider.is_active) return 'inactive'");
    expect(processorSource).toContain("if (provider.inbound_paused_at) return 'paused'");
    expect(processorSource).toContain("outcome: 'skipped'");
  });

  it('connects rollback to unpause and webhook re-registration', () => {
    expect(activitySource).toContain(
      ".where({ inbound_pause_reason: 'tenant_cancelled' })",
    );
    const clearPause = lifecycleSource.indexOf('inbound_paused_at: null');
    const microsoftRegistration = lifecycleSource.indexOf(
      'await adapter.initializeWebhook(',
      clearPause,
    );
    const googleRegistration = lifecycleSource.indexOf(
      'registerWebhookSubscription()',
      clearPause,
    );

    expect(clearPause).toBeGreaterThan(-1);
    expect(microsoftRegistration).toBeGreaterThan(clearPause);
    expect(googleRegistration).toBeGreaterThan(clearPause);
  });
});
