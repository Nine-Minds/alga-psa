/**
 * Pure quote discount allocation.
 *
 * Quote discounts are persisted as positive amounts that are subtracted from
 * the quote total. Grouped quote rendering needs to know, per cadence group,
 * how much of each discount reduces recurring versus one-time charges. That
 * reduction is derived from the eligible base items a discount targets rather
 * than from the discount row's own cadence fields (which are historically
 * `false`/null even for discounts aimed at recurring services).
 *
 * This module is the single source of truth for that derivation. It is shared
 * by the draft/editor totals, the persisted recalculation service, and the
 * quote document adapter so every consumer derives the same allocation.
 *
 * Policy implemented here (per the quote-discount-group-allocation plan):
 * - Eligible bases are selected, non-discount quote items. Optional items that
 *   are not selected contribute neither base nor allocation. Amounts are
 *   non-negative integer minor units; zero bases receive nothing.
 * - Item-targeted discounts allocate only to the matching item. Service-
 *   targeted discounts allocate across every eligible item carrying that
 *   service. Whole-quote discounts (no target) allocate across every eligible
 *   base item.
 * - Fixed discounts resolve to `quantity * unit_price`; percentage discounts
 *   use the existing rounding rule (`round(eligibleBase * pct / 100)`) and are
 *   then capped. Capping happens against the base value not already consumed
 *   by earlier discounts (processed in display order) so an oversized or
 *   stacked discount can never push a group or the quote below zero.
 * - Integer cents are conserved with deterministic largest-remainder
 *   allocation; the caller's base-item order breaks ties.
 * - A discount spanning recurring and one-time bases splits proportionally;
 *   there is no first-match-cadence shortcut. Derived cadence splits are
 *   reported per discount so group summaries can subtract each allocated
 *   amount exactly once.
 */

export type QuoteDiscountType = 'fixed' | 'percentage';

export interface DiscountBaseItemInput {
  /** quote_item_id (or draft local_id). */
  id: string;
  serviceId?: string | null;
  /** quantity * unit_price in minor units; non-negative. */
  amount: number;
  /** True when the base item belongs to the recurring cadence group. */
  isRecurring: boolean;
}

export interface QuoteDiscountInput {
  id: string;
  discountType: QuoteDiscountType;
  /** Fixed discount value in minor units (quantity * unit_price). */
  fixedAmount?: number | null;
  /** Percentage discount rate (e.g. 10 for 10%). */
  discountPercentage?: number | null;
  appliesToItemId?: string | null;
  appliesToServiceId?: string | null;
}

export interface QuoteDiscountItemAllocation {
  baseItemId: string;
  /** Allocated reduction in minor units; positive. */
  amount: number;
  isRecurring: boolean;
}

export interface QuoteDiscountAllocationResult {
  discountId: string;
  /** Total resolved reduction for this discount in minor units; positive. */
  resolvedAmount: number;
  /** Per-base allocations; sums to resolvedAmount. */
  allocations: QuoteDiscountItemAllocation[];
  /** Sum of allocations landing on recurring bases. */
  recurringAmount: number;
  /** Sum of allocations landing on one-time bases. */
  onetimeAmount: number;
}

export interface QuoteDiscountAllocation {
  discounts: QuoteDiscountAllocationResult[];
  /** Sum of all resolved discounts in minor units. */
  totalDiscount: number;
}

const toNonNegativeInt = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
};

function discountNominalAmount(
  discount: QuoteDiscountInput,
  eligibleBaseAmount: number
): number {
  if (discount.discountType === 'percentage') {
    const percent = toNonNegativeInt(Number(discount.discountPercentage ?? 0));
    return Math.round((eligibleBaseAmount * percent) / 100);
  }

  const fixed = toNonNegativeInt(Number(discount.fixedAmount ?? 0));
  return fixed;
}

/**
 * Resolve discount allocations against eligible base items.
 *
 * `bases` must be supplied in stable display order and contain only included,
 * non-discount items. `discounts` must be supplied in display order; each
 * discount is applied against the remaining eligible base value so discounts
 * cannot, in aggregate, reduce a base below zero.
 */
export function allocateQuoteDiscounts(
  bases: DiscountBaseItemInput[],
  discounts: QuoteDiscountInput[]
): QuoteDiscountAllocation {
  const remainingByBase = new Map<string, number>();
  for (const base of bases) {
    remainingByBase.set(base.id, toNonNegativeInt(base.amount));
  }

  const results: QuoteDiscountAllocationResult[] = [];

  for (const discount of discounts) {
    let eligible: DiscountBaseItemInput[];
    if (discount.appliesToItemId) {
      const matched = bases.find((base) => base.id === discount.appliesToItemId);
      eligible = matched ? [matched] : [];
    } else if (discount.appliesToServiceId) {
      eligible = bases.filter((base) => base.serviceId === discount.appliesToServiceId);
    } else {
      eligible = bases;
    }

    const remainingEligible = eligible
      .map((base) => ({ base, remaining: remainingByBase.get(base.id) ?? 0 }))
      .filter((entry) => entry.remaining > 0);

    const eligibleBaseAmount = eligible.reduce((sum, base) => sum + toNonNegativeInt(base.amount), 0);
    const nominal = discountNominalAmount(discount, eligibleBaseAmount);
    const remainingCapacity = remainingEligible.reduce((sum, entry) => sum + entry.remaining, 0);
    const resolved = Math.min(nominal, remainingCapacity);

    const allocations: QuoteDiscountItemAllocation[] = [];
    if (resolved > 0 && remainingEligible.length > 0) {
      const weightTotal = remainingEligible.reduce((sum, entry) => sum + entry.remaining, 0);
      const shares = remainingEligible.map((entry) => {
        const exact = (resolved * entry.remaining) / weightTotal;
        return {
          base: entry.base,
          share: Math.floor(exact),
          remainder: exact - Math.floor(exact),
        };
      });

      let distributed = shares.reduce((sum, entry) => sum + entry.share, 0);
      let leftover = resolved - distributed;
      const byRemainder = [...shares]
        .map((entry, index) => ({ ...entry, index }))
        .sort((a, b) => {
          if (b.remainder !== a.remainder) return b.remainder - a.remainder;
          return a.index - b.index;
        });

      for (const entry of byRemainder) {
        if (leftover <= 0) break;
        entry.share += 1;
        leftover -= 1;
        distributed += 1;
      }

      const byIndex = [...byRemainder].sort((a, b) => a.index - b.index);
      for (const entry of byIndex) {
        if (entry.share <= 0) continue;
        allocations.push({
          baseItemId: entry.base.id,
          amount: entry.share,
          isRecurring: entry.base.isRecurring,
        });
        remainingByBase.set(entry.base.id, (remainingByBase.get(entry.base.id) ?? 0) - entry.share);
      }
    }

    const recurringAmount = allocations
      .filter((allocation) => allocation.isRecurring)
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    const onetimeAmount = allocations
      .filter((allocation) => !allocation.isRecurring)
      .reduce((sum, allocation) => sum + allocation.amount, 0);

    results.push({
      discountId: discount.id,
      resolvedAmount: resolved,
      allocations,
      recurringAmount,
      onetimeAmount,
    });
  }

  const totalDiscount = results.reduce((sum, result) => sum + result.resolvedAmount, 0);

  return { discounts: results, totalDiscount };
}
