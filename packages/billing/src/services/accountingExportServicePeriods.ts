import { normalizeAccountingExportCalendarDate } from './accountingExportDateUtils';

export type AccountingExportBillingTiming = 'arrears' | 'advance';

export type AccountingExportRecurringPeriod = {
  service_period_start: string | null;
  service_period_end: string | null;
  billing_timing: AccountingExportBillingTiming | null;
};

export type AccountingExportRecurringPeriodInput = {
  service_period_start?: unknown;
  service_period_end?: unknown;
  billing_timing?: unknown;
};

/**
 * Normalizes one period row: dates become calendar dates (UTC midnight ISO),
 * unknown billing timings become null.
 */
export function normalizeAccountingExportRecurringPeriod(
  input: AccountingExportRecurringPeriodInput
): AccountingExportRecurringPeriod {
  return {
    service_period_start: normalizeAccountingExportCalendarDate(input.service_period_start) ?? null,
    service_period_end: normalizeAccountingExportCalendarDate(input.service_period_end) ?? null,
    billing_timing:
      input.billing_timing === 'advance' || input.billing_timing === 'arrears'
        ? input.billing_timing
        : null
  };
}

export function compareAccountingExportRecurringPeriods(
  left: AccountingExportRecurringPeriod,
  right: AccountingExportRecurringPeriod
): number {
  if (left.service_period_start !== right.service_period_start) {
    return String(left.service_period_start ?? '').localeCompare(String(right.service_period_start ?? ''));
  }
  if (left.service_period_end !== right.service_period_end) {
    return String(left.service_period_end ?? '').localeCompare(String(right.service_period_end ?? ''));
  }
  return String(left.billing_timing ?? '').localeCompare(String(right.billing_timing ?? ''));
}

/**
 * Normalize + drop rows with neither start nor end + sort (start, end, timing).
 * Does NOT dedupe; used for payload-side comparison.
 */
export function normalizeAndSortAccountingExportRecurringPeriods(
  rows: Iterable<AccountingExportRecurringPeriodInput>
): AccountingExportRecurringPeriod[] {
  return Array.from(rows, (row) => normalizeAccountingExportRecurringPeriod(row ?? {}))
    .filter((period) => period.service_period_start || period.service_period_end)
    .sort(compareAccountingExportRecurringPeriods);
}

/**
 * The single definition of a charge's canonical recurring detail periods:
 * each distinct (start, end, billing_timing) once, sorted by start then end.
 * Shared by the export selector (payload) and validation (expected value).
 */
export function projectAccountingExportRecurringPeriods(
  rows: Iterable<AccountingExportRecurringPeriodInput>
): AccountingExportRecurringPeriod[] {
  const distinct = new Map<string, AccountingExportRecurringPeriod>();
  for (const period of normalizeAndSortAccountingExportRecurringPeriods(rows)) {
    distinct.set(
      `${period.service_period_start ?? ''}|${period.service_period_end ?? ''}|${period.billing_timing ?? ''}`,
      period
    );
  }
  return Array.from(distinct.values());
}
