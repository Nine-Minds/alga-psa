import { proxyActivities } from '@temporalio/workflow';
import type { WorkflowRuntimeV2TemporalRunInput } from '@alga-psa/workflows/lib/workflowRuntimeV2Temporal';

const activities = proxyActivities<{
  executeWorkflowRuntimeV2Run(input: { runId: string; executionKey: string }): Promise<void>;
}>({
  startToCloseTimeout: '10m',
  retry: {
    maximumAttempts: 1,
  },
});

export async function workflowRuntimeV2RunWorkflow(input: WorkflowRuntimeV2TemporalRunInput): Promise<void> {
  await activities.executeWorkflowRuntimeV2Run({
    runId: input.runId,
    executionKey: input.executionKey,
  });
}
