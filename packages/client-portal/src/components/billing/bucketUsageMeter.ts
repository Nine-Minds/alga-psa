/**
 * Shared remaining-hours math and meter colors for the client-portal bucket
 * surfaces (Billing overview meter + dashboard widget).
 *
 * The remaining semantics mirror `getRemainingBucketUnits` in
 * `packages/reporting`: remaining = total + rollover − used.
 */

import type { ClientBucketUsageResult } from '@alga-psa/client-portal/actions';

export type BucketMinutesFields = Pick<
  ClientBucketUsageResult,
  'total_minutes' | 'rolled_over_minutes' | 'minutes_used'
>;

export function getRemainingMinutes(bucket: BucketMinutesFields): number {
  return bucket.total_minutes + bucket.rolled_over_minutes - bucket.minutes_used;
}

export function formatBucketHours(hours: number): string {
  return hours.toFixed(1);
}

export interface BucketMeterColors {
  text: string;
  bg: string;
  bgLight: string;
  border: string;
}

/**
 * Thresholds mirror the legacy used-percentage meter (90%/75%) expressed as
 * remaining fraction of the total available (base + rollover). A negative
 * remaining value (overage) is always destructive.
 */
export function getBucketMeterColors(
  remainingMinutes: number,
  totalMinutes: number
): BucketMeterColors {
  const remainingFraction = totalMinutes > 0 ? remainingMinutes / totalMinutes : 0;
  if (remainingFraction <= 0.1) {
    return {
      text: 'text-destructive',
      bg: 'bg-destructive',
      bgLight: 'bg-destructive/10',
      border: 'border-destructive/30',
    };
  }
  if (remainingFraction <= 0.25) {
    return {
      text: 'text-warning',
      bg: 'bg-warning',
      bgLight: 'bg-warning/10',
      border: 'border-warning/30',
    };
  }
  return {
    text: 'text-success',
    bg: 'bg-success',
    bgLight: 'bg-success/10',
    border: 'border-success/30',
  };
}
