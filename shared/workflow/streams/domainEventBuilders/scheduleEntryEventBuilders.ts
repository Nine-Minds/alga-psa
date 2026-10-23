import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

/**
 * SCHEDULE_ENTRY_CREATED / UPDATED / DELETED (payload.ScheduleEntry*.v1). `userId` is the acting user
 * (the schema requires it; the publish context carries the same user as the actor). `changes` is
 * free-form: `after` on create, `before`/`after` on update, `before` on delete, plus per-site extras.
 */
type ScheduleEntryEventParams = {
  entryId: string;
  userId: string;
  changes?: Record<string, unknown>;
};

function scheduleEntryPayload(params: ScheduleEntryEventParams) {
  return {
    entryId: params.entryId,
    userId: params.userId,
    ...(params.changes ? { changes: params.changes } : {}),
  };
}

export function buildScheduleEntryCreatedPayload(
  params: ScheduleEntryEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'SCHEDULE_ENTRY_CREATED'> {
  return builtWorkflowPayload('SCHEDULE_ENTRY_CREATED', scheduleEntryPayload(params));
}

export function buildScheduleEntryUpdatedPayload(
  params: ScheduleEntryEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'SCHEDULE_ENTRY_UPDATED'> {
  return builtWorkflowPayload('SCHEDULE_ENTRY_UPDATED', scheduleEntryPayload(params));
}

export function buildScheduleEntryDeletedPayload(
  params: ScheduleEntryEventParams
): Record<string, unknown> & BuiltWorkflowPayload<'SCHEDULE_ENTRY_DELETED'> {
  return builtWorkflowPayload('SCHEDULE_ENTRY_DELETED', scheduleEntryPayload(params));
}
