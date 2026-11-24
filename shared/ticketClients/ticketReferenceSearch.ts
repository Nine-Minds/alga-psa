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
 * TICKET could also be read as an email label. Explicit references match segment prefixes, while
 * numeric-only references retain their suffix search behavior.
 */
export function resolveTicketNumberMatches(
  ticketNumbers: readonly (string | null | undefined)[],
  query: TicketSearchQuery
): ReadonlySet<string> {
  const numbers = ticketNumbers
    .map((raw) => ({ raw: raw ?? '', compact: compactTicketReference(raw ?? '') }))
    .filter(({ compact }) => Boolean(compact));
  if (!query.reference && !query.literalReference) return new Set();

  const exactLiteral = query.literalReference
    ? numbers.filter(({ compact }) => compact === query.literalReference)
    : [];
  if (exactLiteral.length > 0) return new Set(exactLiteral.map(({ compact }) => compact));

  const exactReference = query.reference
    ? numbers.filter(({ compact }) => compact === query.reference)
    : [];
  if (exactReference.length > 0) return new Set(exactReference.map(({ compact }) => compact));

  if (query.isExplicitLabel) {
    const references = [query.reference, query.literalReference].filter(Boolean);
    return new Set(numbers
      .filter(({ raw, compact }) => references.some((reference) => matchesExplicitReference(raw, compact, reference)))
      .map(({ compact }) => compact));
  }

  const references = [query.literalReference, query.reference];
  return new Set(numbers
    .filter(({ compact }) => references.some((reference) => reference && compact.includes(reference)))
    .map(({ compact }) => compact));
}

/**
 * Explicit ticket references match at the start of a loaded number or as a partial prefix of a
 * number segment. A reference embedded at the end of a longer identifier is a different ticket.
 * Pure numeric references keep their existing suffix-search behavior.
 */
function matchesExplicitReference(rawNumber: string, compactNumber: string, reference: string): boolean {
  if (/^\d+$/.test(reference)) return compactNumber.includes(reference);
  const index = compactNumber.indexOf(reference);
  if (index === 0) return true;
  if (index < 0 || index + reference.length === compactNumber.length) return false;

  let compactIndex = 0;
  for (const character of rawNumber) {
    if (/[\s-]/.test(character)) {
      if (compactIndex === index) return true;
      continue;
    }
    if (compactIndex === index) return false;
    compactIndex += 1;
  }
  return false;
}
