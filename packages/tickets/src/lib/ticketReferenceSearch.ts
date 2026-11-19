/**
 * Pure helpers for matching a pasted ticket reference (e.g. "Ticket #ALGA-2026-0002826")
 * against a stored ticket_number. No React, DB or server-only imports, so both the
 * client portal and the MSP ticket search can use it.
 */

// Optional leading "Ticket" (a whole word) followed by optional "#", with whitespace around them.
const LEADING_TICKET_PREFIX = /^(?:ticket(?![a-z0-9])\s*)?#?\s*/i;
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
  const reference = compactTicketReference(text.replace(LEADING_TICKET_PREFIX, ''));
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
