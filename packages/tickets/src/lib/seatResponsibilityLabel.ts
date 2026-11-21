import type { TicketResponsibility } from './ticketResponsibility';

/** The one wording of who is responsible, shared by the list column, filter and the ticket screen chip. */
export function seatResponsibilityLabel(
  t: (key: string, defaultValue: string) => string,
  responsibility: TicketResponsibility,
): string {
  return responsibility === 'client_it'
    ? t('seatResponsibility.clientIt', 'Client IT')
    : t('seatResponsibility.msp', 'MSP');
}
