import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { WorkflowExecutionAlreadyStartedError, type Client } from '@temporalio/client';
import { getJobRunner } from '../jobRunnerAccessor';

export const THREECX_CALL_CONTROL_RECONCILE_JOB = 'reconcile-threecx-call-control';

// Mirrors ee/temporal-workflows/src/lib/threecxCallControlConstants.ts, which
// this package cannot import.
export const THREECX_CALL_CONTROL_WORKFLOW_TYPE = 'threecxCallControlWorkflow';
export const THREECX_CALL_CONTROL_TASK_QUEUE = 'tenant-workflows';
export const THREECX_CALL_CONTROL_STOP_SIGNAL = 'stop';

export function threecxCallControlWorkflowId(tenantId: string): string {
  return `threecx-callcontrol:${tenantId}`;
}

export interface ThreecxCallControlReconcileInput {
  tenantId?: string;
}

export type ThreecxCallControlReconcileAction = 'started' | 'already_running' | 'stopped' | 'not_running' | 'skipped';

export interface ThreecxCallControlReconcileResult {
  success: boolean;
  tenantId?: string;
  shouldRun: boolean;
  action: ThreecxCallControlReconcileAction;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The socket runs only for an active row whose PBX is connected with Call Control. */
export function shouldRunThreecxCallControl(row: { status?: unknown; config?: unknown } | null | undefined): boolean {
  if (!row || row.status !== 'active') return false;
  let config: unknown = row.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      return false;
    }
  }
  const pbx = obj(obj(config).pbx);
  return pbx.status === 'connected' && obj(pbx.capabilities).callControl === true;
}

function isWorkflowNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'WorkflowNotFoundError' || /not found|already completed/i.test(message);
}

async function temporalClient(): Promise<Client | null> {
  const runner = await getJobRunner();
  const provider = runner as unknown as { getClient?: () => Client };
  if (runner.getRunnerType() !== 'temporal' || typeof provider.getClient !== 'function') return null;
  return provider.getClient();
}

/**
 * Maintenance fan-out job: keeps one `threecxCallControlWorkflow` per tenant
 * in step with the 3cx row. Starting is idempotent (an already-running
 * execution is left alone); stopping a missing execution is a no-op.
 */
export async function reconcileThreecxCallControlHandler(
  input: ThreecxCallControlReconcileInput,
): Promise<ThreecxCallControlReconcileResult> {
  const tenantId = input?.tenantId;
  if (!tenantId) return { success: true, shouldRun: false, action: 'skipped' };

  const { knex } = await createTenantKnex(tenantId);
  const row = await tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider: '3cx' })
    .first<{ status?: unknown; config?: unknown }>();
  const shouldRun = shouldRunThreecxCallControl(row);

  const client = await temporalClient();
  if (!client) {
    logger.warn('[3CX] Call Control reconcile skipped: no Temporal client in this runtime', { tenantId });
    return { success: true, tenantId, shouldRun, action: 'skipped' };
  }

  const workflowId = threecxCallControlWorkflowId(tenantId);
  if (shouldRun) {
    try {
      await client.workflow.start(THREECX_CALL_CONTROL_WORKFLOW_TYPE, {
        taskQueue: THREECX_CALL_CONTROL_TASK_QUEUE,
        workflowId,
        args: [{ tenantId }],
      });
      logger.info('[3CX] Call Control workflow started', { tenantId, workflowId });
      return { success: true, tenantId, shouldRun, action: 'started' };
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return { success: true, tenantId, shouldRun, action: 'already_running' };
      }
      throw error;
    }
  }

  try {
    await client.workflow.getHandle(workflowId).signal(THREECX_CALL_CONTROL_STOP_SIGNAL);
    logger.info('[3CX] Call Control workflow signalled to stop', { tenantId, workflowId });
    return { success: true, tenantId, shouldRun, action: 'stopped' };
  } catch (error) {
    if (isWorkflowNotFound(error)) return { success: true, tenantId, shouldRun, action: 'not_running' };
    throw error;
  }
}
