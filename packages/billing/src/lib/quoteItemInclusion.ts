/**
 * One quote-item inclusion rule for the whole quote pipeline.
 *
 * There are two distinct questions the codebase asks about a line item, and
 * conflating them is what let optional add-ons inflate the presented base
 * price:
 *
 * - **Base/required inclusion** (`isRequired`): the presented base price is
 *   built from required (non-optional) rows only, regardless of selection.
 *   Optional rows are a proposed add-on shown separately with an "if selected"
 *   amount. The view-model base totals, the per-cadence bands and the editor
 *   summary all key off this.
 *
 * - **Legacy inclusion** (`isQuoteItemIncluded`): the historical rule used by
 *   persisted recalculation/conversion and by the frozen legacy
 *   `recurring_*`/`onetime_*` bindings that existing catalog rows and custom
 *   clones still render. Required rows always count; optional rows count only
 *   while selected. It is retained byte-for-byte so stored totals and legacy
 *   documents do not move.
 */

export type QuoteItemInclusionInput = {
  is_optional?: boolean | null;
  is_selected?: boolean | null;
};

/** Required (non-optional) rows are the base price, regardless of selection. */
export const isRequired = (item: QuoteItemInclusionInput): boolean => !item.is_optional;

/** Optional rows are a proposed add-on, never part of the base price. */
export const isOptional = (item: QuoteItemInclusionInput): boolean => Boolean(item.is_optional);

/**
 * Legacy rule: required rows always count; optional rows count only while
 * selected. Used by persisted recalculation/conversion and the legacy
 * recurring/one-time bindings. Do not repurpose for base totals.
 */
export const isQuoteItemIncluded = (item: QuoteItemInclusionInput): boolean => {
  if (!item.is_optional) return true;
  return item.is_selected === true;
};
