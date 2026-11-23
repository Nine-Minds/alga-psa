import { cleanSearchIdentifierQuery } from './searchIdentifier';

// Inspect after all separators: hyphenated TICKET prefixes are identifiers, while
// whitespace-separated "Ticket ALGA…" is a label.
const LEADING_TICKET_PREFIX = /^ticket([\s-]*)/i;
const SEPARATORS = /[\s-]+/g;

function stripLeadingTicketLabel(value: string): string {
  const match = LEADING_TICKET_PREFIX.exec(value);
  if (!match) return value;

  const nextCharacter = value[match[0].length];
  const hasSeparators = match[1].length > 0;
  const hyphenatedAlphaPrefix = match[1].startsWith('-') && /^[a-z]/i.test(nextCharacter ?? '');
  if (
    nextCharacter === '#' ||
    nextCharacter === undefined ||
    (hasSeparators && !/\d/.test(nextCharacter) && !hyphenatedAlphaPrefix)
  ) {
    return value.slice(match[0].length);
  }

  return value;
}

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
  const reference = compactTicketReference(cleanSearchIdentifierQuery(stripLeadingTicketLabel(text)));
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
