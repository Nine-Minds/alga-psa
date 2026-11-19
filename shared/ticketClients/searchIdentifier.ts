/**
 * Derives the ticket/entity identifier a list search compares against
 * `app_search_index.metadata->>'identifier'`.
 *
 * Two distinct concepts:
 *  - `exact`: the whole cleaned query, lowercased. Compared with `=`.
 *  - `prefix`: only set when the cleaned query is a single number-shaped token
 *    (letters, optional hyphen, digits — e.g. `TIC0002826`, `ALGA-2026`, `TIC123`).
 *    Used for `LIKE prefix || '%'`. A multi-group number such as
 *    `ALGA-2026-0002826` is already complete, so it must not widen to its siblings.
 */
const SINGLE_NUMBER_TOKEN_RE = /^[A-Z]+-?\d+$/i;
const FULL_MULTI_GROUP_NUMBER_RE = /^[A-Z]+(?:-\d+){2,}$/i;

export interface SearchIdentifierMatch {
  exact: string | null;
  prefix: string | null;
  /**
   * True when the query is a complete multi-group number (e.g. `ALGA-2026-0002826`). The index
   * stores `client · ticket_number` as the subtitle, so trigram similarity would otherwise match
   * every sibling number; callers disable the fuzzy (trigram) clauses when this is set.
   */
  isFullNumber: boolean;
}

export function cleanSearchIdentifierQuery(rawQuery: string | null | undefined): string {
  return (rawQuery ?? '').trim().replace(/^#+/, '').trim();
}

export function deriveSearchIdentifierMatch(rawQuery: string | null | undefined): SearchIdentifierMatch {
  const cleaned = cleanSearchIdentifierQuery(rawQuery);
  if (!cleaned) {
    return { exact: null, prefix: null, isFullNumber: false };
  }
  const exact = cleaned.toLowerCase();
  return {
    exact,
    prefix: SINGLE_NUMBER_TOKEN_RE.test(cleaned) ? exact : null,
    isFullNumber: FULL_MULTI_GROUP_NUMBER_RE.test(cleaned),
  };
}
