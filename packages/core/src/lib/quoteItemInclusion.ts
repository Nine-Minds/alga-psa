/**
 * The one quote-item inclusion rule for the whole quote pipeline.
 *
 * Every place that turns quote rows into money — the persisted recalculation
 * (`quotes.subtotal/tax/total_amount`, which the quote list shows), the editor
 * sidebar, the rendered PDF, the client portal and quote conversion — asks the
 * same question of a line: does it count toward the quote total right now?
 *
 * - A **required** row (`is_optional` false) always counts.
 * - An **optional** row counts only while it is **selected**
 *   (`is_selected === true`). The MSP sets the initial selection in the editor
 *   (an add-on defaults to unselected); the customer can change it in the
 *   portal before accepting. What is selected at acceptance is exactly what
 *   conversion converts.
 * - An optional row that is **not selected** is a *pending* add-on: it is
 *   presented separately with an "if selected" amount (price plus the tax it
 *   would carry) and contributes nothing to the total.
 *
 * `is_selected` is nullable on legacy inputs; anything but `true` means "not
 * selected". Do not re-derive these predicates inline — import them.
 */

export type QuoteItemInclusionInput = {
  is_optional?: boolean | null;
  is_selected?: boolean | null;
};

/** Required (non-optional) rows always count toward the quote total. */
export const isRequired = (item: QuoteItemInclusionInput): boolean => !item.is_optional;

/** Optional rows are add-ons; whether they count depends on selection. */
export const isOptional = (item: QuoteItemInclusionInput): boolean => Boolean(item.is_optional);

/** True when the row is selected. Only `true` is a selection. */
export const isSelected = (item: QuoteItemInclusionInput): boolean => item.is_selected === true;

/**
 * The inclusion rule: required rows always count; optional rows count only
 * while selected. This is what persisted totals, the editor, the PDF, the
 * portal and conversion all use.
 */
export const isQuoteItemIncluded = (item: QuoteItemInclusionInput): boolean =>
  isRequired(item) || isSelected(item);

/**
 * An optional row that is not selected: presented as an "if selected" add-on
 * and excluded from the total.
 */
export const isPendingOptional = (item: QuoteItemInclusionInput): boolean =>
  isOptional(item) && !isSelected(item);
