import { builtWorkflowPayload } from '@alga-psa/event-schemas';

/** Legacy compatibility export. Date recurrence calculations live in packages/jobs/dateTriggers/annual. */
export function buildClientAnniversaryUpcomingPayload(params: { clientId: string; clientName: string; anniversaryDate: string; yearsAsClient: number; daysUntilAnniversary: number }) {
  return builtWorkflowPayload('CLIENT_ANNIVERSARY_UPCOMING', { ...params });
}
