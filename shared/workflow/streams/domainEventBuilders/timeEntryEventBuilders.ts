import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * TIME_ENTRY_SUBMITTED / TIME_ENTRY_APPROVED (payload.TimeEntrySubmitted.v1 / TimeEntryApproved.v1).
 *
 * The workflow schema models only ticket and project-task time. `time_entries.work_item_type`
 * stores lowercase values and also holds ad-hoc / interaction / non-billable work, which the
 * schema has no representation for. `toWorkflowTimeEntryWorkItemType` maps the stored value and
 * returns null for the rest; emitters publish the non-catalogued TIME_ENTRY_UPDATED (same search
 * reindex trigger) for those entries instead of an invalid catalogued payload.
 */
export type WorkflowTimeEntryWorkItemType = 'TICKET' | 'PROJECT_TASK';

export function toWorkflowTimeEntryWorkItemType(
  workItemType: string | null | undefined
): WorkflowTimeEntryWorkItemType | null {
  switch (String(workItemType ?? '').toLowerCase()) {
    case 'ticket':
      return 'TICKET';
    case 'project_task':
      return 'PROJECT_TASK';
    default:
      return null;
  }
}

type TimeEntryEventParams = {
  timeEntryId: string;
  userId: string;
  workItemId: string;
  workItemType: WorkflowTimeEntryWorkItemType;
  /** Legacy fields the search indexer and notification subscribers read. */
  approvedBy?: string;
  reason?: string;
  changes?: Record<string, unknown>;
  timestamp?: string;
};

function timeEntryPayload(params: TimeEntryEventParams) {
  return {
    timeEntryId: params.timeEntryId,
    userId: params.userId,
    workItemId: params.workItemId,
    workItemType: params.workItemType,
    ...(params.approvedBy ? { approvedBy: params.approvedBy } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.changes ? { changes: params.changes } : {}),
    ...(params.timestamp ? { timestamp: params.timestamp } : {}),
  };
}

export function buildTimeEntrySubmittedPayload(
  params: TimeEntryEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'TIME_ENTRY_SUBMITTED'> {
  return builtWorkflowPayload('TIME_ENTRY_SUBMITTED', timeEntryPayload(params));
}

export function buildTimeEntryApprovedPayload(
  params: TimeEntryEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'TIME_ENTRY_APPROVED'> {
  return builtWorkflowPayload('TIME_ENTRY_APPROVED', timeEntryPayload(params));
}
