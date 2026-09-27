/**
 * Shared, dependency-free arithmetic for a one-time mid-period recurring-unit
 * quantity true-up.
 *
 * A recurring product or explicitly unit-priced Fixed service normally changes
 * only at a canonical service-period boundary. An operator may explicitly opt
 * in to a *quantity-only* change effective inside an eligible unbilled period:
 * the new standing quantity begins at the next canonical boundary, and one
 * prorated charge (increase) or credit (decrease) covers the partial period
 * from the mid-period date to that boundary.
 *
 * Amount convention (matches the engine's existing coverage proration, which
 * rounds once with `Math.ceil`):
 *
 *   amount = sign(delta) * ceil( ceil(|delta| × unitRateCents) × coveredDays / fullPeriodDays )
 *
 * Date convention: canonical service periods are half-open `[start, end)`.
 * Persisted invoice-detail rows use the legacy *inclusive* last covered day, so
 * an inclusive end maps to the following calendar day before it is used as an
 * exclusive end. Never treat the two endpoints as interchangeable.
 */

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

export interface RecurringUnitMidPeriodCalculation extends RecurringUnitMidPeriodCalculationInput {
  /** Signed minor-unit amount: positive is a charge, negative is a credit. */
  amountCents: number;
}

/**
 * Add calendar days to a `YYYY-MM-DD` date, returning `YYYY-MM-DD`. Uses UTC so
 * a date-only value never shifts across a timezone boundary.
 */
export function addDaysOnly(day: string, days: number): string {
  const [year, month, date] = day.split('-').map((part) => Number(part));
  const base = Date.UTC(year, (month ?? 1) - 1, date ?? 1);
  const next = new Date(base + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/**
 * Convert a legacy inclusive detail end (last covered day) to the half-open
 * exclusive end (the following day). Returns null for an unparseable value so
 * callers fail loudly rather than silently mis-prorating.
 */
export function inclusiveEndToExclusiveEnd(inclusiveEnd: string | null | undefined): string | null {
  if (!inclusiveEnd || !/^\d{4}-\d{2}-\d{2}$/.test(inclusiveEnd)) return null;
  return addDaysOnly(inclusiveEnd, 1);
}

/** Whole calendar days between two `YYYY-MM-DD` dates (to − from). */
export function daysBetweenOnly(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('A valid calendar date (YYYY-MM-DD) is required.');
  }
  return Math.round((end - start) / 86_400_000);
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
  if (!Number.isFinite(fullPeriodDays) || fullPeriodDays <= 0) {
    throw new Error('fullPeriodDays must be greater than zero');
  }
  if (!Number.isFinite(coveredDays) || coveredDays < 0) {
    throw new Error('coveredDays must not be negative');
  }
  if (coveredDays > fullPeriodDays) {
    throw new Error('coveredDays must not exceed fullPeriodDays');
  }
  if (quantityDelta === 0 || unitRateCents === 0 || coveredDays === 0) {
    return { ...input, amountCents: 0 };
  }
  const magnitude = Math.ceil(
    Math.ceil(Math.abs(quantityDelta) * unitRateCents) * (coveredDays / fullPeriodDays),
  );
  return { ...input, amountCents: quantityDelta > 0 ? magnitude : -magnitude };
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
