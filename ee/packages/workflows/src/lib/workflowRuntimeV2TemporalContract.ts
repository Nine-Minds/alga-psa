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
