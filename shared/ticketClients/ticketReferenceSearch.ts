import { cleanSearchIdentifierQuery } from './searchIdentifier';

// "Ticket #ALGA…" is an email label. Plain "Ticket" is also a label before
// words or a single numeric suffix; multiple numeric groups can be a literal TICKET number.
const LEADING_TICKET_LABEL = /^ticket(?=$|#|\s+(?:[^\s\d-]|\d+\s*$))/i;
const SEPARATORS = /[\s-]+/g;

export interface TicketSearchQuery {
  /** The query trimmed of surrounding whitespace; use for title/status/priority matching. */
  text: string;
  /**
   * The query as an email-labeled ticket reference: leading "Ticket"/"#" removed, separators
   * removed, and lowercased. Empty when nothing is left to compare.
   */
  reference: string;
  /** The literal number form; Ticket is retained unless followed by the email marker #. */
  literalReference: string;
  /** True when the trimmed input starts with the email label marker, including a leading #. */
  isExplicitLabel: boolean;
}

export function compactTicketReference(value: string): string {
  return value.replace(SEPARATORS, '').toLowerCase();
}

export function parseTicketSearchQuery(rawQuery: string): TicketSearchQuery {
  const text = rawQuery.trim();
  const cleaned = cleanSearchIdentifierQuery(text);
  const emailReferenceText = text.replace(/^ticket\s*#\s*/i, '');
  const hashIntroducedText = text.replace(/^#\s*/, '');
  const labelText = /^ticket\s*#/i.test(text)
    ? emailReferenceText
    : text.startsWith('#')
      ? hashIntroducedText
      : cleaned.replace(LEADING_TICKET_LABEL, '');
  const reference = compactTicketReference(cleanSearchIdentifierQuery(labelText));
  const literalText = /^ticket\s*#/i.test(text) ? emailReferenceText : cleaned;
  const literalReference = compactTicketReference(cleanSearchIdentifierQuery(literalText));
  const isExplicitLabel = /^(?:ticket\s*)?#/i.test(text);
  return { text, reference, literalReference, isExplicitLabel };
}

/** Number match using the same loaded-row resolution and ambiguity rules as the portal predicate. */
export function ticketNumberMatchesQuery(
  ticketNumber: string | null | undefined,
  query: TicketSearchQuery
): boolean {
  if (!ticketNumber) return false;
  return resolveTicketNumberMatches([ticketNumber], query).has(compactTicketReference(ticketNumber));
}

/**
 * Resolve number matches against the loaded rows. Exact literal identifiers win when a leading
 * TICKET could also be read as an email label. All comparisons use the compact number.
 */
export function resolveTicketNumberMatches(
  ticketNumbers: readonly (string | null | undefined)[],
  query: TicketSearchQuery
): ReadonlySet<string> {
  const references = [query.literalReference, query.reference].filter(Boolean);
  if (!references.length) return new Set();

  const numbers = ticketNumbers.map((number) => compactTicketReference(number ?? ''));
  for (const reference of references) {
    if (numbers.includes(reference)) return new Set([reference]);
  }

  if (query.isExplicitLabel && !/^\d+$/.test(query.reference)) {
    // An alphanumeric reference can be a partial match while more of the number
    // follows. A match occurring only as another identifier's suffix is a different ticket.
    return new Set(numbers.filter((number) => {
      const start = number.indexOf(query.reference);
      return start >= 0 && start + query.reference.length < number.length;
    }));
  }

  return new Set(numbers.filter((number) => references.some((reference) => number.includes(reference))));
}
