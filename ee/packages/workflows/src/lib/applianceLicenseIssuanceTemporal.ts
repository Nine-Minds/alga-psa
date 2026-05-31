import type { ApplianceLicenseIssuanceInput } from '@ee/temporal-workflows/src/workflows/appliance-license-issuance-workflow';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const TASK_QUEUE = process.env.WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE ?? 'alga-workflows';

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
    });
    return { workflowId: handle.workflowId };
  } catch (error: unknown) {
    // WorkflowAlreadyStartedError → idempotent, already running/completed
    if ((error as any)?.name === 'WorkflowExecutionAlreadyStartedError') {
      return { workflowId };
    }
    throw error;
  } finally {
    await connection.close().catch(() => undefined);
  }
}
