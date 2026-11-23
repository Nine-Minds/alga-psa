import { parseTicketSearchQuery, ticketNumberMatchesQuery } from '@shared/ticketClients/ticketReferenceSearch';

interface SearchableTicket {
  title?: string | null;
  ticket_number?: string | null;
  status_name?: string | null;
  priority_name?: string | null;
}

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
