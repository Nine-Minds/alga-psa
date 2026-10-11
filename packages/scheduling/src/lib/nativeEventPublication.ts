import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildScheduleEntryCreatedPayload,
  buildScheduleEntryDeletedPayload,
  buildScheduleEntryUpdatedPayload,
} from '@alga-psa/workflow-streams';
import type { NativeTimeReviewEvent } from '@alga-psa/co-managed';
import { publishTimeEntrySearchEvent } from './timeEntrySearchEvents';

export type NativeScheduleEvent = {
  eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED' | 'SCHEDULE_ENTRY_DELETED';
  payload: { tenantId: string; userId: string; entryId: string };
};

export type CoManagedNativeEvent = NativeScheduleEvent | NativeTimeReviewEvent;

/**
 * Co-managed native commands (schedule, appointment and time-review) hand back
 * plain `{ eventType, payload }` records after commit. Each one is published
 * through the same typed builders the local actions use, so a co-managed write
 * honours the workflow event contract exactly as a local one does.
 */
function isScheduleEvent(event: CoManagedNativeEvent): event is NativeScheduleEvent {
  return event.eventType === 'SCHEDULE_ENTRY_CREATED' || event.eventType === 'SCHEDULE_ENTRY_UPDATED' || event.eventType === 'SCHEDULE_ENTRY_DELETED';
}

export async function publishNativeEvent(event: CoManagedNativeEvent): Promise<void> {
  if (isScheduleEvent(event)) {
    const { tenantId, userId, entryId } = event.payload;
    const ctx = { tenantId, actor: { actorType: 'USER' as const, actorUserId: userId } };
    if (event.eventType === 'SCHEDULE_ENTRY_CREATED') {
      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_CREATED', payload: buildScheduleEntryCreatedPayload({ userId, entryId }), ctx });
    } else if (event.eventType === 'SCHEDULE_ENTRY_UPDATED') {
      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: buildScheduleEntryUpdatedPayload({ userId, entryId }), ctx });
    } else {
      await publishWorkflowEvent({ eventType: 'SCHEDULE_ENTRY_DELETED', payload: buildScheduleEntryDeletedPayload({ userId, entryId }), ctx });
    }
    return;
  }
  const review: NativeTimeReviewEvent = event;
  await publishTimeEntrySearchEvent(review.eventType, review.payload);
}
