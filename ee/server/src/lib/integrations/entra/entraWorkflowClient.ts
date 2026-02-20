import type {
  EntraAllTenantsSyncWorkflowInput,
  EntraDiscoveryWorkflowInput,
  EntraInitialSyncWorkflowInput,
  EntraTenantSyncWorkflowInput,
} from '../../../../../temporal-workflows/src/types/entra-sync';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'tenant-workflows';

export interface EntraWorkflowStartResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  error?: string;
}

export interface EntraWorkflowQueryResult {
  available: boolean;
  workflowId: string;
  status?: string;
  error?: string;
}

function generateWorkflowId(prefix: string, tenantId: string): string {
  return `${prefix}:${tenantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

async function getTemporalClient(): Promise<any | null> {
  const mod: any = await import('@temporalio/client').catch(() => null);
  if (!mod) {
    return null;
  }

  const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
  const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
  const connection = await mod.Connection.connect({ address });
  const client = new mod.Client({ connection, namespace });
  return { mod, connection, client };
}

async function startWorkflow(
  workflowName: string,
  workflowId: string,
  input: unknown
): Promise<EntraWorkflowStartResult> {
  try {
    const temporal = await getTemporalClient();
    if (!temporal) {
      return { available: false, error: 'Temporal client not available' };
    }

    const handle = await temporal.client.workflow.start(workflowName, {
      args: [input],
      taskQueue: process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowId,
      workflowExecutionTimeout: '2h',
      workflowTaskTimeout: '1m',
    });

    await temporal.connection.close().catch(() => undefined);

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    };
  } catch (error: unknown) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Failed to start workflow',
    };
  }
}

export async function startEntraDiscoveryWorkflow(
  input: EntraDiscoveryWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId('entra-discovery', input.tenantId);
  return startWorkflow('entraDiscoveryWorkflow', workflowId, input);
}

export async function startEntraInitialSyncWorkflow(
  input: EntraInitialSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId('entra-initial-sync', input.tenantId);
  return startWorkflow('entraInitialSyncWorkflow', workflowId, input);
}

export async function startEntraAllTenantsSyncWorkflow(
  input: EntraAllTenantsSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId('entra-all-tenants-sync', input.tenantId);
  return startWorkflow('entraAllTenantsSyncWorkflow', workflowId, input);
}

export async function startEntraTenantSyncWorkflow(
  input: EntraTenantSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId(
    `entra-tenant-sync:${input.managedTenantId}`,
    input.tenantId
  );
  return startWorkflow('entraTenantSyncWorkflow', workflowId, input);
}

export async function queryEntraWorkflowStatus(
  workflowId: string
): Promise<EntraWorkflowQueryResult> {
  try {
    const temporal = await getTemporalClient();
    if (!temporal) {
      return { available: false, workflowId, error: 'Temporal client not available' };
    }

    const handle = temporal.client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    await temporal.connection.close().catch(() => undefined);

    return {
      available: true,
      workflowId,
      status: description?.status?.name || 'UNKNOWN',
    };
  } catch (error: unknown) {
    return {
      available: false,
      workflowId,
      error: error instanceof Error ? error.message : 'Failed to query workflow status',
    };
  }
}
