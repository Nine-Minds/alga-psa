import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildTimeEntryApprovedPayload,
  buildTimeEntrySubmittedPayload,
  toWorkflowTimeEntryWorkItemType,
} from '@alga-psa/workflow-streams';

/**
 * Time-entry lifecycle events. TIME_ENTRY_SUBMITTED / TIME_ENTRY_APPROVED go through the typed
 * builders when the entry is ticket or project-task time; everything else reindexes search
 * through the non-catalogued TIME_ENTRY_* types. Shared by the time-entry actions and the
 * co-managed native time commands so both honour the same workflow contract.
 */
export type TimeEntrySearchEventType =
  | 'TIME_ENTRY_CREATED'
  | 'TIME_ENTRY_UPDATED'
  | 'TIME_ENTRY_DELETED'
  | 'TIME_ENTRY_SUBMITTED'
  | 'TIME_ENTRY_APPROVED'
  | 'TIME_ENTRY_CHANGES_REQUESTED';

export async function publishTimeEntrySearchEvent(
  eventType: TimeEntrySearchEventType,
  payload: {
    tenantId: string;
    timeEntryId: string;
    userId?: string;
    workItemId?: string | null;
    workItemType?: string | null;
    approvedBy?: string;
    deletedBy?: string;
    requestedBy?: string;
    reason?: string;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const workItemType = toWorkflowTimeEntryWorkItemType(payload.workItemType);
    if (
      (eventType === 'TIME_ENTRY_SUBMITTED' || eventType === 'TIME_ENTRY_APPROVED') &&
      workItemType &&
      payload.userId &&
      payload.workItemId
    ) {
      const params = {
        timeEntryId: payload.timeEntryId,
        userId: payload.userId,
        workItemId: payload.workItemId,
        workItemType,
        approvedBy: payload.approvedBy,
        reason: payload.reason,
        changes: payload.changes,
        timestamp,
      };
      const ctx = {
        tenantId: payload.tenantId,
        actor: { actorType: 'USER' as const, actorUserId: payload.approvedBy ?? payload.userId },
      };
      if (eventType === 'TIME_ENTRY_SUBMITTED') {
        await publishWorkflowEvent({ eventType, payload: buildTimeEntrySubmittedPayload(params), ctx });
      } else {
        await publishWorkflowEvent({ eventType, payload: buildTimeEntryApprovedPayload(params), ctx });
      }
      return;
    }
    // Ad-hoc / interaction / non-billable time has no workflow representation (the schema models
    // ticket and project-task time only), so it reindexes search through TIME_ENTRY_UPDATED.
    await publishEvent({
      eventType: eventType === 'TIME_ENTRY_SUBMITTED' || eventType === 'TIME_ENTRY_APPROVED' ? 'TIME_ENTRY_UPDATED' : eventType,
      payload: { ...payload, timestamp },
    });
  } catch (eventError) {
    console.error(`[TimeEntryActions] Failed to publish ${eventType} event`, eventError);
  }
}
