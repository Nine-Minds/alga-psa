import { Temporal } from '@js-temporal/polyfill';
import type { DuePosition, ISO8601String, RecurringDueWorkCadenceSource } from '@alga-psa/types';

/**
 * Calendar month-end early-close policy.
 *
 * A monthly-ARREARS recurring obligation is normally invoiced once its invoice
 * window opens — for a calendar-month service period billed in arrears that is
 * the 1st of the following month (`invoiceWindowStart === servicePeriodEnd`).
 * An authorized billing admin may instead close the period on its FINAL
 * calendar day (`servicePeriodEnd − 1 day`, because periods are half-open
 * `[start, end)`), generating the true month-end arrears invoice one day early.
 *
 * This is an explicit manual exception for calendar-month arrears candidates
 * ONLY. It never widens what ordinary automatic generation may do: automatic
 * eligibility keeps comparing against `invoiceWindowStart`, and the manual
 * path is only offered when this policy says the period is closable today.
 *
 * Timezone discipline: eligibility is defined against the local calendar date
 * in the EFFECTIVE BILLING timezone. Service periods are stored as date-only
 * boundaries on the billing calendar, so `asOfDate` (a caller-supplied local
 * calendar date) and `asOf`/`timeZone` (an instant resolved to the billing
 * timezone) are equivalent inputs — the caller passes whichever it holds and
 * the calendar comparison below is identical. Generation always passes an
 * instant + timezone so "today" is the tenant's calendar day, never the
 * worker host's.
 */

export type CalendarMonthEndCloseEligibilityReason =
  | 'eligible'
  | 'not_arrears'
  | 'not_client_cadence'
  | 'not_calendar_month_period'
  | 'window_does_not_open_next_day'
  | 'not_final_calendar_day';

export interface CalendarMonthEndEarlyCloseEligibilityInput {
  duePosition: DuePosition;
  /** When provided, only client-cadence (schedule-owned) periods qualify. */
  cadenceSource?: RecurringDueWorkCadenceSource | null;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  invoiceWindowStart: ISO8601String;
  /**
   * The candidate's "today", as a local calendar date (YYYY-MM-DD). Provide
   * exactly one of `asOfDate` or `asOf` + `timeZone`.
   */
  asOfDate?: ISO8601String;
  /** The current instant, resolved to `timeZone` for the local calendar date. */
  asOf?: string | Date;
  timeZone?: string;
}

export interface CalendarMonthEndCloseEligibility {
  eligible: boolean;
  reason: CalendarMonthEndCloseEligibilityReason;
  /** The service period's final calendar day (servicePeriodEnd − 1 day). */
  finalCalendarDay: ISO8601String;
}

function toDateOnly(value: ISO8601String): Temporal.PlainDate {
  return Temporal.PlainDate.from(value.slice(0, 10));
}

function localCalendarDate(asOf?: string | Date, timeZone?: string): Temporal.PlainDate | null {
  if (!asOf) return null;
  let tz = timeZone ?? 'UTC';
  try {
    Temporal.TimeZone.from(tz);
  } catch {
    tz = 'UTC';
  }
  try {
    const instant =
      asOf instanceof Date
        ? Temporal.Instant.from(asOf.toISOString())
        : Temporal.Instant.from(asOf);
    return instant.toZonedDateTimeISO(tz).toPlainDate();
  } catch {
    return null;
  }
}

export function evaluateCalendarMonthEndEarlyCloseEligibility(
  input: CalendarMonthEndEarlyCloseEligibilityInput,
): CalendarMonthEndCloseEligibility {
  const end = toDateOnly(input.servicePeriodEnd);
  const finalCalendarDay = end.subtract({ days: 1 }).toString() as ISO8601String;
  const fail = (
    reason: Exclude<CalendarMonthEndCloseEligibilityReason, 'eligible'>,
  ): CalendarMonthEndCloseEligibility => ({ eligible: false, reason, finalCalendarDay });

  if (input.duePosition !== 'arrears') {
    return fail('not_arrears');
  }

  if (input.cadenceSource && input.cadenceSource !== 'client_schedule') {
    return fail('not_client_cadence');
  }

  // The service period must be a true calendar month: it starts on the 1st and
  // ends exactly one month later. Anchored monthly cadences (day 10, day 28)
  // produce periods whose "final day" is not a calendar month-end, and advance
  // periods have no arrears close at all — both stay on the normal path.
  const start = toDateOnly(input.servicePeriodStart);
  if (start.day !== 1 || Temporal.PlainDate.compare(end, start.add({ months: 1 })) !== 0) {
    return fail('not_calendar_month_period');
  }

  // Arrears invoice windows open the day after the service period ends
  // (service period June → invoice window July). If that invariant does not
  // hold this is not the period a month-end close would cover.
  if (toDateOnly(input.invoiceWindowStart).toString() !== end.toString()) {
    return fail('window_does_not_open_next_day');
  }

  // The manual close is only available ON the final calendar day of the period
  // — the day before the normal window would open. Any earlier (the window has
  // not yet closed), any later (the normal window is open, so the ordinary
  // generation path applies), and the manual action is refused.
  const asOfDate = input.asOfDate
    ? toDateOnly(input.asOfDate)
    : localCalendarDate(input.asOf, input.timeZone);
  if (!asOfDate || asOfDate.toString() !== finalCalendarDay) {
    return fail('not_final_calendar_day');
  }

  return { eligible: true, reason: 'eligible', finalCalendarDay };
}

export function isCalendarMonthEndEarlyCloseEligible(
  input: CalendarMonthEndEarlyCloseEligibilityInput,
): boolean {
  return evaluateCalendarMonthEndEarlyCloseEligibility(input).eligible;
}
