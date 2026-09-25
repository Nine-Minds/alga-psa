/** Legacy compatibility export. Date recurrence calculations live in packages/jobs/dateTriggers/annual. */
export function buildClientAnniversaryUpcomingPayload(params: { clientId: string; clientName: string; anniversaryDate: string; yearsAsClient: number; daysUntilAnniversary: number }) {
  return { ...params };
}
