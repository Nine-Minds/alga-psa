import type { TicketResponsibilityState } from './ticketResponsibility';

/**
 * What the ticket screen shows of responsibility. The server sends a state only for a reader the seat
 * shape is offered to and a ticket of a client in a live arrangement, so no state means neither the
 * chip nor the action exist. The action exists only while the MSP holds the ticket: handing it back
 * is the client IT technician's move.
 */
export function ticketResponsibilityVisibility(state: TicketResponsibilityState | null | undefined): { chip: boolean; handoff: boolean } {
  if (!state) return { chip: false, handoff: false };
  return { chip: true, handoff: state.responsibility === 'msp' };
}
