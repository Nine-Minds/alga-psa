import { cleanSearchIdentifierQuery } from './searchIdentifier';

// "Ticket #ALGA…" is an email label. Plain "Ticket" is also a label before
// words or a single numeric suffix; multiple numeric groups can be a literal TICKET number.
const LEADING_TICKET_LABEL = /^ticket(?=$|#|\s+(?:[^\s\d-]|\d+\s*$))/i;
const SEPARATORS = /[\s-]+/g;
const COMPLETE_COMPACT_TICKET_NUMBER = /^[a-z]+\d{10,}$/i;

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
  /** True for a complete number introduced by `#` or the email's `Ticket #` label. */
  isCompleteEmailReference: boolean;
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
  const compactReference = compactTicketReference(labelText.trim());
  const isCompleteEmailReference = isExplicitLabel && COMPLETE_COMPACT_TICKET_NUMBER.test(compactReference);
  return { text, reference, literalReference, isExplicitLabel, isCompleteEmailReference };
}

/** Separator-insensitive substring match for a ticket number and either parsed interpretation. */
export function ticketNumberMatchesQuery(
  ticketNumber: string | null | undefined,
  query: TicketSearchQuery
): boolean {
  if (!ticketNumber) return false;
  return resolveTicketNumberMatches([ticketNumber], query).has(compactTicketReference(ticketNumber));
}

/**
 * Resolve number matches against the loaded rows. Exact literal identifiers win when a leading
 * TICKET could also be read as an email label; otherwise an exact label reference wins before
 * either interpretation falls back to substring matching.
 */
export function resolveTicketNumberMatches(
  ticketNumbers: readonly (string | null | undefined)[],
  query: TicketSearchQuery
): ReadonlySet<string> {
  const numbers = ticketNumbers.map((number) => compactTicketReference(number ?? '')).filter(Boolean);
  if (!query.reference && !query.literalReference) return new Set();

  const exactLiteral = query.literalReference
    ? numbers.filter((number) => number === query.literalReference)
    : [];
  if (exactLiteral.length > 0) return new Set(exactLiteral);

  const exactReference = query.reference ? numbers.filter((number) => number === query.reference) : [];
  if (exactReference.length > 0) return new Set(exactReference);
  if (query.isCompleteEmailReference) return new Set();

  const references = query.isExplicitLabel
    ? [query.reference, query.literalReference]
    : [query.literalReference, query.reference];
  return new Set(numbers.filter((number) => references.some((reference) => reference && number.includes(reference))));
}
