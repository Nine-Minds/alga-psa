import { proxyActivities } from '@temporalio/workflow';

const { recordRuntimeProgress } = proxyActivities({
  startToCloseTimeout: '1 minute',
});

export async function workflowRuntimeV2RunWorkflow(input) {
  const runId = typeof input?.runId === 'string' ? input.runId : 'unknown-run';
  await recordRuntimeProgress({ runId });
  return { runId, status: 'completed-by-workflow-worker' };
}
