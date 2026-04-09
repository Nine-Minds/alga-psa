export const WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE = 'workflow-runtime-v2';
export const WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOW = 'workflowRuntimeV2RunWorkflow';
export const WORKFLOW_RUNTIME_V2_EVENT_SIGNAL = 'workflowRuntimeV2Event';
export const WORKFLOW_RUNTIME_V2_HUMAN_TASK_SIGNAL = 'workflowRuntimeV2HumanTask';

export type WorkflowRuntimeV2TemporalRunInput = {
  runId: string;
  tenantId: string | null;
  workflowId: string;
  workflowVersion: number;
  triggerType: 'event' | 'schedule' | 'recurring' | null;
  executionKey: string;
};

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';

export async function startWorkflowRuntimeV2TemporalRun(
  input: WorkflowRuntimeV2TemporalRunInput
): Promise<{ workflowId: string; firstExecutionRunId: string | null }> {
  const temporal = await import('@temporalio/client');
  const connection = await temporal.Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
  });
  const client = new temporal.Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
  });

  const temporalWorkflowId = `workflow-runtime-v2:run:${input.runId}`;
  try {
    const handle = await client.workflow.start(WORKFLOW_RUNTIME_V2_TEMPORAL_WORKFLOW, {
      taskQueue: WORKFLOW_RUNTIME_V2_TEMPORAL_TASK_QUEUE,
      workflowId: temporalWorkflowId,
      args: [input],
    });

    return {
      workflowId: temporalWorkflowId,
      firstExecutionRunId: handle.firstExecutionRunId ?? null,
    };
  } finally {
    await connection.close().catch(() => undefined);
  }
}

export async function signalWorkflowRuntimeV2Event(input: {
  runId: string;
  eventId: string;
  eventName: string;
  correlationKey: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
}): Promise<void> {
  const temporal = await import('@temporalio/client');
  const connection = await temporal.Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
  });
  const client = new temporal.Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
  });

  const temporalWorkflowId = `workflow-runtime-v2:run:${input.runId}`;
  try {
    const handle = client.workflow.getHandle(temporalWorkflowId);
    await handle.signal(WORKFLOW_RUNTIME_V2_EVENT_SIGNAL, {
      eventId: input.eventId,
      eventName: input.eventName,
      correlationKey: input.correlationKey,
      payload: input.payload,
      receivedAt: input.receivedAt,
    });
  } finally {
    await connection.close().catch(() => undefined);
  }
}
