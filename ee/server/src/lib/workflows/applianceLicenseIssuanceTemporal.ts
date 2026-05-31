const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
// Non-authored workflows (registered in ee/temporal-workflows non-authored-index)
// are served by the temporal-worker on these queues; tenant-workflows is the
// general-purpose one used by tenant-creation etc.
const TASK_QUEUE = process.env.APPLIANCE_LICENSE_TASK_QUEUE || 'tenant-workflows';

/**
 * Input for the appliance license issuance workflow.
 * Kept in sync with ApplianceLicenseIssuanceInput in
 * ee/temporal-workflows/src/workflows/appliance-license-issuance-workflow.ts
 * (duplicated here to avoid a cross-package type import that doesn't resolve
 * through the @alga-psa/workflows exports map).
 */
export interface ApplianceLicenseIssuanceInput {
  tenant: string;
  submissionId: string;
  clientId: string;
  customer: string;
  tier: 'pro' | 'premium';
  seats?: number;
  transport: string;
  stripeSubId: string;
}

/**
 * Start the appliance license issuance Temporal workflow.
 * Workflow id = license-issue:{paymentIntentId} → exactly-once.
 */
export async function startApplianceLicenseIssuance(
  paymentIntentId: string,
  input: ApplianceLicenseIssuanceInput
): Promise<{ workflowId: string }> {
  const temporal = await import('@temporalio/client');
  const connection = await temporal.Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
  });
  const client = new temporal.Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
  });

  const workflowId = `license-issue:${paymentIntentId}`;
  try {
    const handle = await client.workflow.start('applianceLicenseIssuanceWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
      workflowExecutionTimeout: '1h',
    });
    return { workflowId: handle.workflowId };
  } catch (error: unknown) {
    // WorkflowExecutionAlreadyStartedError → idempotent, already running/completed
    if ((error as any)?.name === 'WorkflowExecutionAlreadyStartedError') {
      return { workflowId };
    }
    throw error;
  } finally {
    await connection.close().catch(() => undefined);
  }
}
