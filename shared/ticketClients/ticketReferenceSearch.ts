import { cleanSearchIdentifierQuery } from './searchIdentifier';

const LEADING_TICKET_LABEL = /^ticket(?=\s|#|$)/i;
const SEPARATORS = /[\s-]+/g;

export interface TicketSearchQuery {
  /** The query trimmed of surrounding whitespace; use for title/status/priority matching. */
  text: string;
  /**
   * The query as a ticket reference: leading "Ticket"/"#" removed, hyphens and spaces removed,
   * lowercased. Empty when nothing is left to compare.
   */
  reference: string;
}

export function compactTicketReference(value: string): string {
  return value.replace(SEPARATORS, '').toLowerCase();
}

export function parseTicketSearchQuery(rawQuery: string): TicketSearchQuery {
  const text = rawQuery.trim();
  const reference = compactTicketReference(cleanSearchIdentifierQuery(text.replace(LEADING_TICKET_LABEL, '')));
  return { text, reference };
}

/** Substring match on the separator-insensitive form, so "2826" finds "ALGA-2026-0002826". */
export function ticketNumberMatchesQuery(
  ticketNumber: string | null | undefined,
  query: TicketSearchQuery
): boolean {
  if (!ticketNumber || !query.reference) return false;
  return compactTicketReference(ticketNumber).includes(query.reference);
}
