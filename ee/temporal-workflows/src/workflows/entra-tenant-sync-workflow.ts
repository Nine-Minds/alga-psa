import { log, proxyActivities, workflowInfo } from '@temporalio/workflow';
import type {
  EntraSyncRunSummary,
  EntraSyncWorkflowResult,
  EntraTenantSyncResult,
  EntraTenantSyncWorkflowInput,
} from '../types/entra-sync';

const activities = proxyActivities<{
  upsertSyncRunActivity(input: {
    tenantId: string;
    workflowId: string;
    runType: 'single-tenant';
    initiatedBy?: string;
  }): Promise<{ runId: string }>;
  loadMappedTenantsActivity(input: {
    tenantId: string;
    managedTenantId?: string;
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
  startToCloseTimeout: '30m',
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

export async function entraTenantSyncWorkflow(
  input: EntraTenantSyncWorkflowInput
): Promise<EntraSyncWorkflowResult> {
  const workflowId = workflowInfo().workflowId;
  const run = await activities.upsertSyncRunActivity({
    tenantId: input.tenantId,
    workflowId,
    runType: 'single-tenant',
    initiatedBy: input.actor?.userId,
  });

  log.info('Starting Entra tenant sync workflow', {
    tenantId: input.tenantId,
    workflowId,
    runId: run.runId,
    managedTenantId: input.managedTenantId,
    clientId: input.clientId,
    requestedAt: input.requestedAt || null,
  });

  const mappedTenants = await activities.loadMappedTenantsActivity({
    tenantId: input.tenantId,
    managedTenantId: input.managedTenantId,
  });

  const selectedMapping = mappedTenants.mappings.find((mapping) => {
    if (mapping.managedTenantId !== input.managedTenantId) {
      return false;
    }
    if (input.clientId && mapping.clientId && mapping.clientId !== input.clientId) {
      return false;
    }
    return true;
  });

  if (!selectedMapping) {
    const summary = createEmptySummary(0);
    await activities.finalizeSyncRunActivity({
      tenantId: input.tenantId,
      runId: run.runId,
      status: 'completed',
      summary,
    });

    return {
      runId: run.runId,
      status: 'completed',
      summary,
      tenantResults: [],
    };
  }

  let tenantResult: EntraTenantSyncResult;
  try {
    tenantResult = await activities.syncTenantUsersActivity({
      tenantId: input.tenantId,
      runId: run.runId,
      mapping: selectedMapping,
    });
  } catch (error: unknown) {
    tenantResult = {
      managedTenantId: selectedMapping.managedTenantId,
      clientId: selectedMapping.clientId || null,
      status: 'failed',
      created: 0,
      linked: 0,
      updated: 0,
      ambiguous: 0,
      inactivated: 0,
      errorMessage: error instanceof Error ? error.message : 'Tenant sync failed.',
    };
  }

  await activities.recordSyncTenantResultActivity({
    tenantId: input.tenantId,
    runId: run.runId,
    result: tenantResult,
  });

  const summary = createEmptySummary(1);
  summary.processedTenants = 1;
  if (tenantResult.status === 'completed') {
    summary.succeededTenants = 1;
  } else {
    summary.failedTenants = 1;
  }
  summary.created = tenantResult.created;
  summary.linked = tenantResult.linked;
  summary.updated = tenantResult.updated;
  summary.ambiguous = tenantResult.ambiguous;
  summary.inactivated = tenantResult.inactivated;

  const status = tenantResult.status === 'completed' ? 'completed' : 'failed';
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
    tenantResults: [tenantResult],
  };
}
