/**
 * Temporal client for Appliance Console operator actions.
 *
 * Every action is a workflow on the general `tenant-workflows` queue (the
 * worker there already holds ALGA_LICENSE_SERVICE_SECRET and STRIPE_SECRET_KEY).
 * Workflow ids are deterministic per audit row so a retried trigger dedupes
 * instead of running twice. The audit log id rides along in the workflow memo
 * so the status poller can close the audit row when the run ends.
 */

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const TASK_QUEUE = process.env.APPLIANCE_LICENSE_TASK_QUEUE || 'tenant-workflows';

export type ApplianceAction =
  | 'create'
  | 'update'
  | 'reissue-install-code'
  | 'reissue-activation-code'
  | 'airgap-key'
  | 'extend-pro'
  | 'entitlement'
  | 'status'
  | 'revoke'
  | 'revoke-appliance'
  | 'pause-billing'
  | 'resume-billing';

export const APPLIANCE_WORKFLOW_NAMES: Record<ApplianceAction, string> = {
  create: 'applianceCreateTenantWorkflow',
  update: 'applianceUpdateTenantWorkflow',
  'reissue-install-code': 'applianceReissueInstallCodeWorkflow',
  'reissue-activation-code': 'applianceReissueActivationCodeWorkflow',
  'airgap-key': 'applianceAirgapKeyWorkflow',
  'extend-pro': 'applianceExtendProWorkflow',
  entitlement: 'applianceChangeEntitlementWorkflow',
  status: 'applianceSetStatusWorkflow',
  revoke: 'applianceRevokeWorkflow',
  'revoke-appliance': 'applianceRevokeApplianceWorkflow',
  'pause-billing': 'applianceBillingPauseWorkflow',
  'resume-billing': 'applianceBillingResumeWorkflow',
};

export function applianceWorkflowId(action: ApplianceAction, tenantId: string, auditLogId: string): string {
  return `appliance-${action}:${tenantId}:${auditLogId}`;
}

export type ApplianceWorkflowState = 'running' | 'completed' | 'failed';

export interface ApplianceWorkflowStatus {
  workflow_id: string;
  state: ApplianceWorkflowState;
  result?: unknown;
  error?: string;
  audit_log_id: string | null;
}

function isErrorNamed(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name?: unknown }).name === name;
}

/**
 * Temporal wraps failures: WorkflowFailedError → ActivityFailure → ApplicationFailure
 * (the C4 error text). Walk to the innermost message so the operator sees
 * "No active entitlement for this tenant", not "Activity task failed".
 */
function errorMessage(error: unknown, fallback: string): string {
  let current: unknown = error;
  let deepest: string | null = null;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && message) deepest = message;
    current = (current as { cause?: unknown }).cause;
  }
  return deepest ?? (error instanceof Error && error.message ? error.message : fallback);
}

async function connect(): Promise<{ client: any; connection: { close: () => Promise<void> } }> {
  const mod: any = await import('@temporalio/client');
  const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
  const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
  const connection = await mod.Connection.connect({ address });
  const client = new mod.Client({ connection, namespace });
  return { client, connection };
}

/**
 * Start an operator-action workflow. Idempotent on the deterministic workflow
 * id: a duplicate trigger for the same audit row returns the existing run.
 */
export async function startApplianceWorkflow(input: {
  action: ApplianceAction;
  tenantId: string;
  auditLogId: string;
  args: unknown;
}): Promise<{ workflowId: string }> {
  const workflowId = applianceWorkflowId(input.action, input.tenantId, input.auditLogId);
  const { client, connection } = await connect();
  try {
    await client.workflow.start(APPLIANCE_WORKFLOW_NAMES[input.action], {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input.args],
      memo: { auditLogId: input.auditLogId, tenantId: input.tenantId, action: input.action },
      workflowExecutionTimeout: '1h',
    });
    return { workflowId };
  } catch (error) {
    if (isErrorNamed(error, 'WorkflowExecutionAlreadyStartedError')) return { workflowId };
    throw error;
  } finally {
    await connection.close().catch(() => undefined);
  }
}

/** Describe a workflow and, once terminal, surface its result or failure. */
export async function getApplianceWorkflowStatus(workflowId: string): Promise<ApplianceWorkflowStatus | null> {
  const { client, connection } = await connect();
  try {
    const handle = client.workflow.getHandle(workflowId);
    let description: any;
    try {
      description = await handle.describe();
    } catch (error) {
      if (isErrorNamed(error, 'WorkflowNotFoundError')) return null;
      throw error;
    }
    const memo = (description?.memo ?? {}) as Record<string, unknown>;
    const auditLogId = typeof memo.auditLogId === 'string' ? memo.auditLogId : null;
    return mapDescriptionToStatus(workflowId, description?.status?.name, auditLogId, () => handle.result());
  } finally {
    await connection.close().catch(() => undefined);
  }
}

/** Pure mapping from a Temporal status name to the console's state, fetching the result when terminal. */
export async function mapDescriptionToStatus(
  workflowId: string,
  statusName: unknown,
  auditLogId: string | null,
  fetchResult: () => Promise<unknown>,
): Promise<ApplianceWorkflowStatus> {
  if (statusName === 'RUNNING' || statusName === 'CONTINUED_AS_NEW') {
    return { workflow_id: workflowId, state: 'running', audit_log_id: auditLogId };
  }
  if (statusName === 'COMPLETED') {
    try {
      const result = await fetchResult();
      return { workflow_id: workflowId, state: 'completed', result, audit_log_id: auditLogId };
    } catch (error) {
      return { workflow_id: workflowId, state: 'failed', error: errorMessage(error, 'Workflow result unavailable'), audit_log_id: auditLogId };
    }
  }
  let failure = `Workflow ended with status ${typeof statusName === 'string' ? statusName.toLowerCase() : 'unknown'}`;
  try {
    await fetchResult();
  } catch (error) {
    failure = errorMessage(error, failure);
  }
  return { workflow_id: workflowId, state: 'failed', error: failure, audit_log_id: auditLogId };
}

/** One-time secrets (codes, keys) are shown to the operator but never stored in the audit row. */
export function redactWorkflowResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    out[k] = k === 'jwt' || k === 'code' || k === 'install_code' ? '[redacted]' : v;
  }
  return out;
}
