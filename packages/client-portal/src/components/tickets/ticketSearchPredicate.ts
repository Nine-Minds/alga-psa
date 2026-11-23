import {
  compactTicketReference,
  parseTicketSearchQuery,
  resolveTicketNumberMatches,
} from '@shared/ticketClients/ticketReferenceSearch';

interface SearchableTicket {
  title?: string | null;
  ticket_number?: string | null;
  status_name?: string | null;
  priority_name?: string | null;
}

/** Returns a predicate for the portal search box; an empty/whitespace query matches everything. */
export function buildTicketSearchPredicate(
  rawQuery: string,
  loadedTickets: readonly SearchableTicket[]
): (ticket: SearchableTicket) => boolean {
  const query = parseTicketSearchQuery(rawQuery);
  if (!query.text) return () => true;
  const text = query.text.toLowerCase();
  const matchingNumbers = resolveTicketNumberMatches(
    loadedTickets.map(({ ticket_number }) => ticket_number),
    query
  );
  return (ticket) =>
    Boolean(ticket.title?.toLowerCase().includes(text)) ||
    matchingNumbers.has(compactTicketReference(ticket.ticket_number ?? '')) ||
    Boolean(ticket.status_name?.toLowerCase().includes(text)) ||
    Boolean(ticket.priority_name?.toLowerCase().includes(text));
}
