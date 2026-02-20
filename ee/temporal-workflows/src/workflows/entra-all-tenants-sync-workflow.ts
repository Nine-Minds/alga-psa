import { log, proxyActivities, workflowInfo } from '@temporalio/workflow';
import type {
  EntraAllTenantsSyncWorkflowInput,
  EntraSyncRunSummary,
  EntraSyncWorkflowResult,
  EntraTenantSyncResult,
} from '../types/entra-sync';

const activities = proxyActivities<{
  upsertSyncRunActivity(input: {
    tenantId: string;
    workflowId: string;
    runType: 'all-tenants';
    initiatedBy?: string;
  }): Promise<{ runId: string }>;
  loadMappedTenantsActivity(input: {
    tenantId: string;
  }): Promise<{ mappings: Array<{ managedTenantId: string; entraTenantId: string; clientId?: string | null }> }>;
  syncTenantUsersActivity(input: {
    tenantId: string;
    runId: string;
    mapping: { managedTenantId: string; entraTenantId: string; clientId?: string | null };
  }): Promise<EntraTenantSyncResult>;
  recordSyncTenantResultActivity(input: {
    tenantId: string;
    runId: string;
    result: EntraTenantSyncResult;
  }): Promise<void>;
  finalizeSyncRunActivity(input: {
    tenantId: string;
    runId: string;
    status: 'queued' | 'running' | 'completed' | 'partial' | 'failed';
    summary: EntraSyncRunSummary;
  }): Promise<void>;
}>({
  startToCloseTimeout: '2h',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    maximumInterval: '2m',
    backoffCoefficient: 2,
  },
});

function createEmptySummary(totalTenants: number): EntraSyncRunSummary {
  return {
    totalTenants,
    processedTenants: 0,
    succeededTenants: 0,
    failedTenants: 0,
    created: 0,
    linked: 0,
    updated: 0,
    ambiguous: 0,
    inactivated: 0,
  };
}

export async function entraAllTenantsSyncWorkflow(
  input: EntraAllTenantsSyncWorkflowInput
): Promise<EntraSyncWorkflowResult> {
  const workflowId = workflowInfo().workflowId;
  log.info('Starting Entra all-tenants sync workflow', {
    tenantId: input.tenantId,
    trigger: input.trigger,
    workflowId,
    actorUserId: input.actor?.userId,
  });

  const run = await activities.upsertSyncRunActivity({
    tenantId: input.tenantId,
    workflowId,
    runType: 'all-tenants',
    initiatedBy: input.actor?.userId,
  });

  const mappedTenants = await activities.loadMappedTenantsActivity({
    tenantId: input.tenantId,
  });

  const tenantResults: EntraTenantSyncResult[] = [];
  const summary = createEmptySummary(mappedTenants.mappings.length);

  for (const mapping of mappedTenants.mappings) {
    try {
      const tenantResult = await activities.syncTenantUsersActivity({
        tenantId: input.tenantId,
        runId: run.runId,
        mapping,
      });
      tenantResults.push(tenantResult);
      await activities.recordSyncTenantResultActivity({
        tenantId: input.tenantId,
        runId: run.runId,
        result: tenantResult,
      });
    } catch (error: unknown) {
      const failedResult: EntraTenantSyncResult = {
        managedTenantId: mapping.managedTenantId,
        clientId: mapping.clientId || null,
        status: 'failed',
        created: 0,
        linked: 0,
        updated: 0,
        ambiguous: 0,
        inactivated: 0,
        errorMessage: error instanceof Error ? error.message : 'Tenant sync failed.',
      };
      tenantResults.push(failedResult);
      await activities.recordSyncTenantResultActivity({
        tenantId: input.tenantId,
        runId: run.runId,
        result: failedResult,
      });
    }
  }

  for (const result of tenantResults) {
    summary.processedTenants += 1;
    if (result.status === 'completed') {
      summary.succeededTenants += 1;
    } else {
      summary.failedTenants += 1;
    }
    summary.created += result.created;
    summary.linked += result.linked;
    summary.updated += result.updated;
    summary.ambiguous += result.ambiguous;
    summary.inactivated += result.inactivated;
  }

  const status =
    summary.failedTenants === 0
      ? 'completed'
      : summary.succeededTenants > 0
        ? 'partial'
        : 'failed';

  await activities.finalizeSyncRunActivity({
    tenantId: input.tenantId,
    runId: run.runId,
    status,
    summary,
  });

  return {
    runId: run.runId,
    status,
    summary,
    tenantResults,
  };
}
