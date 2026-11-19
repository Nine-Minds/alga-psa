import type { ITicketListItem } from '@alga-psa/types';
import { parseTicketSearchQuery, ticketNumberMatchesQuery } from '@alga-psa/tickets/lib';

type SearchableTicket = Pick<ITicketListItem, 'title' | 'ticket_number' | 'status_name' | 'priority_name'>;

/** Returns a predicate for the portal search box; an empty/whitespace query matches everything. */
export function buildTicketSearchPredicate(rawQuery: string): (ticket: SearchableTicket) => boolean {
  const query = parseTicketSearchQuery(rawQuery);
  if (!query.text) return () => true;
  const text = query.text.toLowerCase();
  return (ticket) =>
    Boolean(ticket.title?.toLowerCase().includes(text)) ||
    ticketNumberMatchesQuery(ticket.ticket_number, query) ||
    Boolean(ticket.ticket_number?.toLowerCase().includes(text)) ||
    Boolean(ticket.status_name?.toLowerCase().includes(text)) ||
    Boolean(ticket.priority_name?.toLowerCase().includes(text));
}
