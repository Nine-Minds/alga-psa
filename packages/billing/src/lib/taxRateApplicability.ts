import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from '@alga-psa/core';
import type { ITaxRate } from '@alga-psa/types';

/**
 * Which rates in a region apply on a given date, and what they add up to.
 *
 * Mirrors the selection in TaxService.calculateTax (packages/billing/src/services/taxService.ts):
 * a rate applies when it is active, has started on or before the date, and has
 * not ended by the date (end_date is exclusive). Every applicable rate is summed,
 * so a region with several overlapping active rates is taxed at their total.
 *
 * The engine also filters by invoice currency (null currency matches all). The
 * UI has no invoice in hand, so currency is ignored here; a currency-specific
 * rate is counted the same as a universal one.
 */
export interface RegionRateSummary {
  /** Every rate belonging to the region, regardless of status. */
  rates: ITaxRate[];
  /** The subset an invoice dated `asOf` would be taxed with. */
  applicable: ITaxRate[];
  /** Sum of the applicable percentages, or null when nothing applies. */
  effectivePercentage: number | null;
}

export type TaxRateStatus = 'inactive' | 'scheduled' | 'expired' | 'current';

const toNumber = (value: number | string): number =>
  typeof value === 'string' ? parseFloat(value) : value;

export function taxRateAppliesOn(rate: ITaxRate, asOf: Temporal.PlainDate): boolean {
  return taxRateStatusOn(rate, asOf) === 'current';
}

export function taxRateStatusOn(rate: ITaxRate, asOf: Temporal.PlainDate): TaxRateStatus {
  if (rate.is_active === false) {
    return 'inactive';
  }
  if (Temporal.PlainDate.compare(toPlainDate(rate.start_date), asOf) > 0) {
    return 'scheduled';
  }
  if (rate.end_date && Temporal.PlainDate.compare(toPlainDate(rate.end_date), asOf) <= 0) {
    return 'expired';
  }
  return 'current';
}

export function summarizeRegionRates(rates: ITaxRate[], asOf: Temporal.PlainDate): RegionRateSummary {
  const applicable = rates.filter((rate) => taxRateAppliesOn(rate, asOf));
  const effectivePercentage = applicable.length === 0
    ? null
    : applicable.reduce((sum, rate) => sum + toNumber(rate.tax_percentage), 0);
  return { rates, applicable, effectivePercentage };
}

/** Groups a flat rate list by region code and summarizes each group. */
export function summarizeRatesByRegion(
  rates: ITaxRate[],
  asOf: Temporal.PlainDate,
): Map<string, RegionRateSummary> {
  const grouped = new Map<string, ITaxRate[]>();
  for (const rate of rates) {
    const bucket = grouped.get(rate.region_code);
    if (bucket) {
      bucket.push(rate);
    } else {
      grouped.set(rate.region_code, [rate]);
    }
  }
  const summaries = new Map<string, RegionRateSummary>();
  for (const [regionCode, regionRates] of grouped) {
    summaries.set(regionCode, summarizeRegionRates(regionRates, asOf));
  }
  return summaries;
}

/** Formats a percentage the way the rate dialog accepts it: no trailing zeros. */
export function formatTaxPercentage(value: number | string): string {
  const numeric = toNumber(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return `${Number(numeric.toFixed(4))}%`;
}
