import { cleanSearchIdentifierQuery } from './searchIdentifier';

// "Ticket #ALGA…" and "Ticket ALGA…" use an email label. A digit or hyphen
// after optional whitespace belongs to the TICKET identifier itself.
const LEADING_TICKET_LABEL = /^ticket(?=$|#|\s+[^\s\d-])/i;
const SEPARATORS = /[\s-]+/g;

export interface TicketSearchQuery {
  /** The query trimmed of surrounding whitespace; use for title/status/priority matching. */
  text: string;
  /**
   * The query as an email-labeled ticket reference: leading "Ticket"/"#" removed, separators
   * removed, and lowercased. Empty when nothing is left to compare.
   */
  reference: string;
  /** The literal query as a ticket number, with leading # and separators removed. */
  literalReference: string;
  /** A complete email reference should match the stored number exactly. */
  exactReference: boolean;
}

export function compactTicketReference(value: string): string {
  return value.replace(SEPARATORS, '').toLowerCase();
}

export function parseTicketSearchQuery(rawQuery: string): TicketSearchQuery {
  const text = rawQuery.trim();
  const cleaned = cleanSearchIdentifierQuery(text);
  const reference = compactTicketReference(cleanSearchIdentifierQuery(cleaned.replace(LEADING_TICKET_LABEL, '')));
  const literalReference = compactTicketReference(cleaned);
  const hasEmailLabel = /^ticket\s*#/i.test(cleaned) || /^#/i.test(cleaned);
  const exactReference = hasEmailLabel && /^[a-z]+\d{4,}$/i.test(reference);
  return { text, reference, literalReference, exactReference };
}

/** Separator-insensitive number matching; complete email references match exactly, short queries by substring. */
export function ticketNumberMatchesQuery(
  ticketNumber: string | null | undefined,
  query: TicketSearchQuery
): boolean {
  if (!ticketNumber || (!query.reference && !query.literalReference)) return false;
  const number = compactTicketReference(ticketNumber);
  if (query.exactReference) return number === query.reference;
  return [query.literalReference, query.reference].some((reference) => reference && number.includes(reference));
}
