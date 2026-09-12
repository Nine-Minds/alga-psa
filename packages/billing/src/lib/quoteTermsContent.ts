import { flattenBlockContentToPlainText } from '@alga-psa/formatting/blocknoteUtils';

/**
 * Shared write-path normalizer for the dual quote Terms & Conditions columns.
 *
 * Rules (see ee/docs/plans/2026-09-12-quote-terms-rich-text/PRD.md FR8/FR9/FR11):
 *  - When structured `terms_and_conditions_block` is present and non-empty it is
 *    authoritative; `terms_and_conditions` becomes its flattened projection.
 *  - When the block is absent, empty or explicitly cleared, the block column is
 *    set to NULL and the caller's plain string (if any) is used verbatim. This is
 *    what makes a REST/workflow plain-string write display exactly what was
 *    written, and what clears a previously-populated rich value.
 *  - When neither key is supplied on an update, both columns are left untouched.
 *
 * Centralizing this here keeps the two columns from drifting across the create,
 * update, duplicate, template and revision paths.
 */
export function isEmptyTermsBlock(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

export function normalizeQuoteTermsFields<T extends Record<string, unknown>>(input: T): T {
  const hasBlockKey =
    Object.prototype.hasOwnProperty.call(input, 'terms_and_conditions_block') &&
    input.terms_and_conditions_block !== undefined;
  const hasTextKey =
    Object.prototype.hasOwnProperty.call(input, 'terms_and_conditions') &&
    input.terms_and_conditions !== undefined;

  if (!hasBlockKey && !hasTextKey) {
    return input;
  }

  const next: Record<string, unknown> = { ...input };

  if (hasBlockKey && !isEmptyTermsBlock(input.terms_and_conditions_block)) {
    next.terms_and_conditions_block = input.terms_and_conditions_block;
    next.terms_and_conditions = flattenBlockContentToPlainText(input.terms_and_conditions_block);
  } else {
    next.terms_and_conditions_block = null;
    next.terms_and_conditions = hasTextKey ? input.terms_and_conditions ?? null : null;
  }

  return next as T;
}
