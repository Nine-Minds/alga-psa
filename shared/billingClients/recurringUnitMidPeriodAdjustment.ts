/**
 * Shared arithmetic for a one-time mid-period recurring-unit quantity true-up.
 *
 * A recurring product or explicitly unit-priced Fixed service normally changes
 * only at a canonical service-period boundary. An operator may explicitly opt
 * in to a *quantity-only* change effective inside an eligible unbilled period:
 * the new standing quantity begins at the next canonical boundary, and one
 * prorated charge (increase) or credit (decrease) covers the partial period
 * from the mid-period date to that boundary.
 *
 * The amount reuses the single shared coverage primitive
 * (`prorateRecurringCoverageByDays`), so it cannot drift from the recurring
 * compute path:
 *
 *   amount = sign(delta) × ceil(ceil(|delta| × unitRateCents) × covered/full)
 *
 * All date arithmetic lives in `coverageProration.ts`; this module re-exports
 * it for existing callers.
 */

import {
  prorateRecurringCoverageByDays,
} from './coverageProration';

export {
  addDaysOnly,
  daysBetweenOnly,
  inclusiveEndToExclusiveEnd,
  isValidDateOnly,
  prorateRecurringCoverageByRatio,
} from './coverageProration';

export interface RecurringUnitMidPeriodCalculationInput {
  /** newQuantity − oldQuantity in force for the affected period. Signed. */
  quantityDelta: number;
  /** Effective unit rate (minor units) for the affected period. Non-negative. */
  unitRateCents: number;
  /** Days from the mid-period effective date to the period end (exclusive). */
  coveredDays: number;
  /** Full length of the affected canonical period in days. */
  fullPeriodDays: number;
}

export interface RecurringUnitMidPeriodCalculation
  extends RecurringUnitMidPeriodCalculationInput {
  /** Signed minor-unit amount: positive is a charge, negative is a credit. */
  amountCents: number;
}

/**
 * The signed, rounded true-up amount for the partial period. Increases are
 * positive charges; decreases are negative credits. A zero delta (returning to
 * the previous quantity, or an explicit no-op) resolves to zero, so no
 * adjustment line is emitted.
 */
export function computeRecurringUnitMidPeriodAdjustment(
  input: RecurringUnitMidPeriodCalculationInput,
): RecurringUnitMidPeriodCalculation {
  const { quantityDelta, unitRateCents, coveredDays, fullPeriodDays } = input;
  if (!Number.isFinite(quantityDelta)) throw new Error('quantityDelta must be finite');
  if (!Number.isFinite(unitRateCents) || unitRateCents < 0) {
    throw new Error('unitRateCents must be a non-negative finite number');
  }
  if (quantityDelta === 0 || unitRateCents === 0) {
    // Still validate the day inputs so a bad request is rejected, not zeroed.
    prorateRecurringCoverageByDays(0, coveredDays, fullPeriodDays);
    return { ...input, amountCents: 0 };
  }
  const amountCents = prorateRecurringCoverageByDays(
    quantityDelta * unitRateCents,
    coveredDays,
    fullPeriodDays,
  );
  return { ...input, amountCents };
}

/** Human-readable reason persisted on the source-linked adjustment line. */
export function formatRecurringUnitMidPeriodReason(params: {
  previousQuantity: number;
  newQuantity: number;
  coveredDays: number;
  fullPeriodDays: number;
  periodStart: string;
  periodEndExclusive: string;
}): string {
  const direction = params.newQuantity >= params.previousQuantity ? 'increase' : 'decrease';
  return (
    `Mid-period quantity ${direction} from ${params.previousQuantity} to ${params.newQuantity}: ` +
    `${Math.abs(params.newQuantity - params.previousQuantity)} units × ` +
    `${params.coveredDays}/${params.fullPeriodDays} days of ${params.periodStart} to ${params.periodEndExclusive}.`
  );
}
