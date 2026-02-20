import type {
  EntraAllTenantsSyncWorkflowInput,
  EntraDiscoveryWorkflowInput,
  EntraInitialSyncWorkflowInput,
  EntraTenantSyncWorkflowInput,
} from '../../../../../temporal-workflows/src/types/entra-sync';
import { createTenantKnex, runWithTenant } from '@/lib/db';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'tenant-workflows';
const MANUAL_WORKFLOW_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

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

export interface EntraSyncRunProgressResult {
  run: {
    runId: string;
    status: string;
    runType: string;
    startedAt: string;
    completedAt: string | null;
    totalTenants: number;
    processedTenants: number;
    succeededTenants: number;
    failedTenants: number;
    summary: Record<string, unknown>;
  } | null;
  tenantResults: Array<{
    managedTenantId: string | null;
    clientId: string | null;
    status: string;
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

function sanitizeWorkflowIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function resolveIdempotencyBucket(requestedAt?: string): string {
  const requestedMs = requestedAt ? Date.parse(requestedAt) : Number.NaN;
  const baseMs = Number.isFinite(requestedMs) ? requestedMs : Date.now();
  const bucketMs = Math.floor(baseMs / MANUAL_WORKFLOW_DEDUPE_WINDOW_MS) * MANUAL_WORKFLOW_DEDUPE_WINDOW_MS;
  const bucketIso = new Date(bucketMs).toISOString();
  return bucketIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function generateWorkflowId(parts: string[], requestedAt?: string): string {
  const normalizedParts = parts.map((part) => sanitizeWorkflowIdSegment(part));
  const bucket = resolveIdempotencyBucket(requestedAt);
  return [...normalizedParts, `bucket-${bucket}`].join(':');
}

function isWorkflowAlreadyStartedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as Record<string, unknown>;
  const name = typeof maybeError.name === 'string' ? maybeError.name : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';
  const code = typeof maybeError.code === 'string' ? maybeError.code : '';

  return (
    name.includes('WorkflowExecutionAlreadyStartedError') ||
    message.includes('Workflow execution already started') ||
    code === 'ALREADY_EXISTS'
  );
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
  let temporal: any | null = null;
  try {
    temporal = await getTemporalClient();
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

    return {
      available: true,
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    };
  } catch (error: unknown) {
    if (temporal && isWorkflowAlreadyStartedError(error)) {
      try {
        const handle = temporal.client.workflow.getHandle(workflowId);
        const description = await handle.describe();
        const describedRunId =
          (description as any)?.execution?.runId ||
          (description as any)?.runId ||
          undefined;

        return {
          available: true,
          workflowId,
          runId: describedRunId,
        };
      } catch {
        return {
          available: true,
          workflowId,
        };
      }
    }

    return {
      available: false,
      error: error instanceof Error ? error.message : 'Failed to start workflow',
    };
  } finally {
    if (temporal?.connection) {
      await temporal.connection.close().catch(() => undefined);
    }
  }
}

export async function startEntraDiscoveryWorkflow(
  input: EntraDiscoveryWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId(['entra-discovery', input.tenantId], input.requestedAt);
  return startWorkflow('entraDiscoveryWorkflow', workflowId, input);
}

export async function startEntraInitialSyncWorkflow(
  input: EntraInitialSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId(['entra-initial-sync', input.tenantId], input.requestedAt);
  return startWorkflow('entraInitialSyncWorkflow', workflowId, input);
}

export async function startEntraAllTenantsSyncWorkflow(
  input: EntraAllTenantsSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId(
    ['entra-all-tenants-sync', input.tenantId, input.trigger],
    input.requestedAt
  );
  return startWorkflow('entraAllTenantsSyncWorkflow', workflowId, input);
}

export async function startEntraTenantSyncWorkflow(
  input: EntraTenantSyncWorkflowInput
): Promise<EntraWorkflowStartResult> {
  const workflowId = generateWorkflowId(
    ['entra-tenant-sync', input.tenantId, input.managedTenantId, input.clientId || ''],
    input.requestedAt
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

export async function getEntraSyncRunProgress(
  tenantId: string,
  runId: string
): Promise<EntraSyncRunProgressResult> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    const [runRow, tenantRows] = await Promise.all([
      knex('entra_sync_runs')
        .where({
          tenant: tenantId,
          run_id: runId,
        })
        .first(),
      knex('entra_sync_run_tenants')
        .where({
          tenant: tenantId,
          run_id: runId,
        })
        .orderBy('created_at', 'asc')
        .select('*'),
    ]);

    return {
      run: runRow
        ? {
            runId: String(runRow.run_id),
            status: String(runRow.status),
            runType: String(runRow.run_type),
            startedAt:
              runRow.started_at instanceof Date
                ? runRow.started_at.toISOString()
                : String(runRow.started_at),
            completedAt:
              runRow.completed_at instanceof Date
                ? runRow.completed_at.toISOString()
                : runRow.completed_at
                  ? String(runRow.completed_at)
                  : null,
            totalTenants: Number(runRow.total_tenants || 0),
            processedTenants: Number(runRow.processed_tenants || 0),
            succeededTenants: Number(runRow.succeeded_tenants || 0),
            failedTenants: Number(runRow.failed_tenants || 0),
            summary:
              runRow.summary && typeof runRow.summary === 'object' && !Array.isArray(runRow.summary)
                ? (runRow.summary as Record<string, unknown>)
                : {},
          }
        : null,
      tenantResults: (tenantRows || []).map((row: any) => ({
        managedTenantId: row.managed_tenant_id ? String(row.managed_tenant_id) : null,
        clientId: row.client_id ? String(row.client_id) : null,
        status: String(row.status),
        created: Number(row.created_count || 0),
        linked: Number(row.linked_count || 0),
        updated: Number(row.updated_count || 0),
        ambiguous: Number(row.ambiguous_count || 0),
        inactivated: Number(row.inactivated_count || 0),
        errorMessage: row.error_message ? String(row.error_message) : null,
        startedAt: row.started_at ? String(row.started_at) : null,
        completedAt: row.completed_at ? String(row.completed_at) : null,
      })),
    };
  });
}
