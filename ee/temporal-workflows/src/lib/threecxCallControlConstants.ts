// Shared between the workflow bundle, the activity and the reconcile job in
// @alga-psa/jobs (which mirrors the strings — it cannot import this package).
export const THREECX_CALL_CONTROL_WORKFLOW_TYPE = 'threecxCallControlWorkflow';
export const THREECX_CALL_CONTROL_TASK_QUEUE = 'tenant-workflows';
export const THREECX_CALL_CONTROL_STOP_SIGNAL = 'stop';
export const THREECX_CALL_EVENT_JOB = 'process-threecx-call-event';

export function threecxCallControlWorkflowId(tenantId: string): string {
  return `threecx-callcontrol:${tenantId}`;
}
