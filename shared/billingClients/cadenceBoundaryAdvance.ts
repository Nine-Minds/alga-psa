import { Temporal } from '@js-temporal/polyfill';
import type { BillingCycleType, ISO8601String } from '@alga-psa/types';
import {
  getNextBillingBoundaryAfter,
  type NormalizedBillingCycleAnchorSettings,
} from './billingCycleAnchors';

/**
 * The cadence a boundary is advanced on. Mirrors how service periods are
 * generated: contract cadence steps whole months from the assignment start
 * (`contractCadenceServicePeriods`), client cadence steps the client's billing
 * schedule (`getNextBillingBoundaryAfter`).
 */
export type CadenceAdvanceRule =
  | { owner: 'contract'; billingCycle: BillingCycleType; anchorDate: string }
  | {
      owner: 'client';
      billingCycle: BillingCycleType;
      anchor: NormalizedBillingCycleAnchorSettings;
    };

function contractMonthsPerPeriod(billingCycle: BillingCycleType): number {
  switch (billingCycle) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semi-annually':
      return 6;
    case 'annually':
      return 12;
    default:
      throw new Error(`Contract cadence does not support billing cycle "${billingCycle}".`);
  }
}

/**
 * The `n`th cadence boundary strictly after `from`, as YYYY-MM-DD (n >= 1).
 * `from` need not sit on a boundary (a clipped first period starts mid-cadence
 * period). Used to date a prepaid block: a block issued for the period that
 * starts at `from` is valid until the `rolloverPeriods + 1`th boundary after
 * that start (exclusive), so rolling over counts whole cadence periods.
 */
export function nthCadenceBoundaryAfter(
  from: string,
  n: number,
  rule: CadenceAdvanceRule,
): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Cannot take the ${n}th cadence boundary; n must be a positive integer.`);
  }
  const start = Temporal.PlainDate.from(from.slice(0, 10));

  if (rule.owner === 'client') {
    let current: ISO8601String = `${start.toString()}T00:00:00Z`;
    for (let step = 0; step < n; step += 1) {
      current = getNextBillingBoundaryAfter(current, rule.billingCycle, rule.anchor);
    }
    return current.slice(0, 10);
  }

  const months = contractMonthsPerPeriod(rule.billingCycle);
  const anchor = Temporal.PlainDate.from(rule.anchorDate.slice(0, 10));
  // Index of the last anchor-aligned boundary at or before `start`.
  let index = Math.max(
    0,
    Math.floor(((start.year - anchor.year) * 12 + (start.month - anchor.month)) / months),
  );
  while (index > 0 && Temporal.PlainDate.compare(anchor.add({ months: index * months }), start) > 0) {
    index -= 1;
  }
  while (Temporal.PlainDate.compare(anchor.add({ months: (index + 1) * months }), start) <= 0) {
    index += 1;
  }
  return anchor.add({ months: (index + n) * months }).toString();
}
