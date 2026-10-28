import { builtWorkflowPayload, type BuiltWorkflowPayload } from '@alga-psa/event-schemas';

function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function buildTicketTimeEntryAddedWorkflowEvent(params: {
  workItemType: string | null | undefined;
  workItemId: string | null | undefined;
  timeEntryId: string;
  minutes: number;
  billable: boolean;
  createdAt?: string | Date | null;
}):
  | {
      eventType: 'TICKET_TIME_ENTRY_ADDED';
      payload: {
        ticketId: string;
        timeEntryId: string;
        minutes: number;
        billable: boolean;
        createdAt?: string;
      } & BuiltWorkflowPayload<'TICKET_TIME_ENTRY_ADDED'>;
    }
  | null {
  if (params.workItemType !== 'ticket') return null;
  if (!params.workItemId) return null;
  if (!Number.isInteger(params.minutes) || params.minutes <= 0) return null;

  const createdAt = toIsoString(params.createdAt ?? undefined);

  return {
    eventType: 'TICKET_TIME_ENTRY_ADDED',
    payload: builtWorkflowPayload('TICKET_TIME_ENTRY_ADDED', {
      ticketId: params.workItemId,
      timeEntryId: params.timeEntryId,
      minutes: params.minutes,
      billable: params.billable,
      ...(createdAt ? { createdAt } : {}),
    }),
  };
}
