/**
 * Prepaid-hours rollforward — pure computation over bucket periods.
 *
 * Sources: persisted `bucket_usage` period rows plus the bucket allowance
 * config (`contract_line_service_bucket_config.total_minutes`, allow_rollover).
 *
 * Valuation (per settled design decision 2): an unburned minute is worth
 * `period fee ÷ included minutes`, where the period fee is the fee actually
 * billed for the bucket period (falling back to the configured fee for
 * not-yet-billed periods). Rollover minutes add to remaining quantity but not
 * to the denominator.
 *
 * Forfeiture is recognized only when a period actually ends: at period end,
 * leftover minutes that do not roll (non-rollover buckets) lapse, as do
 * rolled-in minutes that never compound. Rollover carries at most one period:
 * the carry is the previous period's unused base allowance, which the next
 * bucket period persists as rolled_over_minutes.
 *
  * Movement for month M (all signed like the credits columns — issued grows the
  * liability, applied/expired reduce it):
  *   - issued   = period fee for bucket periods starting in M
  *   - applied  = −minutes burned in M × rate, capped at the value actually
  *                available (fee + carried-in value), so a period's recognized
  *                revenue never exceeds what was billed — the carry's value was
  *                billed in the prior period's fee
  *   - expired  = −forfeited minutes at period ends inside M × rate
  *   - opening  = outstanding value at the start of M × rate
  *   - closing  = outstanding value at the end of M × rate
 *
 * Rollover carry accounting: a carried-in allowance is a liability the moment
 * the prior period ends and rolls, so a period that ends in M recognizes its
 * carry in closing unless the successor period has already started by M's end
 * (then the carry lives inside the successor's balance). Symmetrically, a
 * period that starts on the first calendar day of M opens with its carried-in
 * rollover value. This keeps closing(M) = opening(M+1) and makes the movement
 * columns close arithmetically at the tenant/client level.
 *
 * Burn attribution: periods fully inside M burn their minutes_used in M. For
 * periods spanning month boundaries the v1 fallback attributes the full
 * period's burn to the month the period ends in — the same derivation the
 * reconciliation job uses against dated sources, but simpler and robust to the
 * dated-source gaps. The caller discloses the fallback via report notes.
 */

import { monthKeyOf, monthRange } from './month';
import type { BucketDetailRow, FeeSource } from './types';

export interface BucketPeriodInput {
  usageId: string;
  contractLineId: string;
  contractLineName: string;
  clientId: string;
  serviceId: string;
  serviceName: string;
  /** inclusive calendar day 'YYYY-MM-DD' */
  periodStart: string;
  /** inclusive calendar day 'YYYY-MM-DD' */
  periodEnd: string;
  totalMinutes: number;
  rolledOverMinutes: number;
  minutesUsed: number;
  allowRollover: boolean;
  currencyCode: string;
  /** resolved period fee in minor units (cents). */
  periodFee: number;
  feeSource: FeeSource;
}

export interface BucketPeriodMovement {
  opening: number;
  issued: number;
  applied: number;
  expired: number;
  closing: number;
  detail: BucketDetailRow;
}

export interface HoursRollforward {
  opening: number;
  issued: number;
  applied: number;
  expired: number;
  closing: number;
  details: BucketDetailRow[];
}

function numberOrZero(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Coerce -0 to +0 so movement columns compare and serialize cleanly. */
function signedZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Per-minute rate in minor units; zero when the fee or allowance is absent. */
export function perMinuteRate(totalMinutes: number, periodFee: number): number {
  const included = Math.max(0, totalMinutes);
  const fee = Math.max(0, periodFee);
  if (included <= 0 || fee <= 0) return 0;
  return fee / included;
}

/**
 * Rollforward contribution of one bucket period to one calendar month.
 *
 * @param successorStart the earliest `periodStart` of a later period row for
 *   the same contract line + service. A period that ends in M and rolls its
 *   unused base allowance to the next period recognizes the carry in closing
 *   UNLESS the successor has already started by M's end (then the carry lives
 *   inside the successor's balance and must not be counted twice). When no
 *   successor exists yet (the current, not-yet-rolled period), the carry is
 *   still an outstanding liability and stays in closing.
 */
export function computeBucketPeriodMovement(
  month: string,
  input: BucketPeriodInput,
  options: { successorStart?: string } = {},
): BucketPeriodMovement {
  const { start, endExclusive } = monthRange(month);

  const included = Math.max(0, numberOrZero(input.totalMinutes));
  const rolledOver = Math.max(0, numberOrZero(input.rolledOverMinutes));
  const used = Math.max(0, numberOrZero(input.minutesUsed));
  const fee = Math.max(0, numberOrZero(input.periodFee));
  const rate = perMinuteRate(included, fee);

  const startKey = monthKeyOf(input.periodStart);
  const endKey = monthKeyOf(input.periodEnd);

  const startsInMonth = startKey === month;
  const endsInMonth = endKey === month;
  const startsAtMonthBoundary = input.periodStart === start;
  const activeAtMonthStart = input.periodStart < start && start <= input.periodEnd;
  const overlapsMonth = input.periodStart < endExclusive && input.periodEnd >= start;

  // Issued: the allowance's fee lands in the month the period starts.
  const issued = startsInMonth ? fee : 0;

  // Opening: the outstanding value this period owns at the start of M. A
  // period starting on the first calendar day of M opens with its carried-in
  // rollover value (the liability that crossed the boundary). A period already
  // active at M-start opens with its full allowance + rollover (burn lands in
  // the end month under the v1 attribution).
  let opening = 0;
  if (startsInMonth) {
    opening = startsAtMonthBoundary ? rolledOver * rate : 0;
  } else if (activeAtMonthStart) {
    opening = (included + rolledOver) * rate;
  }

  // Applied: the whole period's burn lands in its end month, signed negative,
  // capped at the value of the minutes actually available — total allowance +
  // carried-in rollover. Burned minutes beyond that are overage, billed
  // separately and outside the prepaid liability. Because the carried-in value
  // was already billed in the prior period's fee, the cap (fee + carry value)
  // still means recognized revenue never exceeds cash received.
  const burn = endsInMonth ? used : 0;
  const applied = -Math.min(burn, included + rolledOver) * rate;

  // Expired: forfeiture is recognized only at the month the period ends in —
  // non-rollover leftovers plus rolled-in minutes that never compound.
  let expired = 0;
  if (endsInMonth) {
    const leftover = Math.max(0, included + rolledOver - used);
    const carry = input.allowRollover ? Math.max(0, included - used) : 0;
    expired = -Math.max(0, leftover - carry) * rate;
  }

  // Closing: outstanding value at the end of M. A period that ended in M keeps
  // its carry unless the successor period has already started (the carry then
  // lives inside the successor). A still-active period keeps its full
  // allowance + rollover (burn lands in its end month).
  let closing = 0;
  if (overlapsMonth) {
    if (endsInMonth) {
      const carry = input.allowRollover ? Math.max(0, included - used) : 0;
      const successorStartedByMonthEnd =
        options.successorStart !== undefined && options.successorStart < endExclusive;
      closing = successorStartedByMonthEnd ? 0 : carry * rate;
    } else {
      closing = (included + rolledOver) * rate;
    }
  }

  const remainingMinutes = Math.max(0, included + rolledOver - used);
  const valueRemaining = remainingMinutes * rate;

  return {
    opening: signedZero(opening),
    issued: signedZero(issued),
    applied: signedZero(applied),
    expired: signedZero(expired),
    closing: signedZero(closing),
    detail: {
      usageId: input.usageId,
      contractLineId: input.contractLineId,
      contractLineName: input.contractLineName,
      serviceId: input.serviceId,
      serviceName: input.serviceName,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalMinutes: included,
      rolledOverMinutes: rolledOver,
      minutesUsed: used,
      remainingMinutes,
      allowRollover: input.allowRollover,
      periodFee: fee,
      perMinuteRate: rate,
      valueRemaining,
      feeSource: input.feeSource,
      notYetBilled: input.feeSource === 'configured',
    },
  };
}

/**
 * Build the hours rollforward for one calendar month across every bucket
 * period of a tenant (or client subset). Returns an aggregate per
 * client×currency together with per-period detail rows.
 */
export function computeHoursRollforward(
  month: string,
  periods: BucketPeriodInput[],
): Map<string, HoursRollforward> {
  const byClientCurrency = new Map<string, HoursRollforward>();
  const periodList = Array.from(periods);

  for (const period of periodList) {
    const currencyCode = period.currencyCode ?? 'USD';
    const key = `${period.clientId}\u0000${currencyCode}`;
    const aggregate = byClientCurrency.get(key) ?? {
      opening: 0,
      issued: 0,
      applied: 0,
      expired: 0,
      closing: 0,
      details: [],
    };

    const successorStart = periodList
      .filter(
        (candidate) =>
          candidate.contractLineId === period.contractLineId &&
          candidate.serviceId === period.serviceId &&
          candidate.periodStart > period.periodStart,
      )
      .reduce<string | undefined>(
        (earliest, candidate) =>
          earliest === undefined || candidate.periodStart < earliest
            ? candidate.periodStart
            : earliest,
        undefined,
      );

    const movement = computeBucketPeriodMovement(month, period, { successorStart });
    aggregate.opening += movement.opening;
    aggregate.issued += movement.issued;
    aggregate.applied += movement.applied;
    aggregate.expired += movement.expired;
    aggregate.closing += movement.closing;
    aggregate.details.push(movement.detail);

    byClientCurrency.set(key, aggregate);
  }

  return byClientCurrency;
}
