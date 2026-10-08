import { addDays, compareDates } from './dates';
import type { NonBusinessDayPolicy } from './rule';

/** Business-day oracle. Implemented by `BusinessDayCalendar` in shared/lib/businessHours. */
export interface BusinessDayChecker {
  isBusinessDay(date: string): boolean;
}

export interface AdjustedOccurrence {
  /** The rule date, before adjustment. This is the idempotency key for a generated occurrence. */
  nominal: string;
  /** The date after applying the non-business-day policy. */
  due: string;
}

/** Longest walk looking for a business day before giving up. */
export const MAX_BUSINESS_DAY_WALK = 31;

/**
 * Applies the per-definition non-business-day policy to nominal dates.
 *
 * - `keep`: dates are returned unchanged.
 * - `previous` / `next`: a non-business date moves to the nearest business day in that direction,
 *   walking at most 31 days; throws when none is found (a calendar with no business days).
 *
 * Nominal dates that collapse onto the same adjusted date keep only the earliest nominal date, so a
 * weekend pair (e.g. Sat 1st and Sun 2nd with `next`) does not create two tickets on Monday.
 * Output is ordered by `due` then `nominal`.
 */
export function adjustForNonBusinessDays(
  dates: readonly string[],
  policy: NonBusinessDayPolicy,
  calendar: BusinessDayChecker
): AdjustedOccurrence[] {
  const sortedNominal = [...dates].sort(compareDates);
  const byDue = new Map<string, AdjustedOccurrence>();

  for (const nominal of sortedNominal) {
    const due = policy === 'keep' ? nominal : shiftToBusinessDay(nominal, policy, calendar);
    if (!byDue.has(due)) {
      byDue.set(due, { nominal, due });
    }
  }

  return [...byDue.values()].sort((a, b) => compareDates(a.due, b.due) || compareDates(a.nominal, b.nominal));
}

function shiftToBusinessDay(
  date: string,
  policy: 'previous' | 'next',
  calendar: BusinessDayChecker
): string {
  if (calendar.isBusinessDay(date)) return date;
  const step = policy === 'previous' ? -1 : 1;
  for (let offset = 1; offset <= MAX_BUSINESS_DAY_WALK; offset += 1) {
    const candidate = addDays(date, step * offset);
    if (calendar.isBusinessDay(candidate)) return candidate;
  }
  throw new Error(
    `No business day found within ${MAX_BUSINESS_DAY_WALK} days ${policy === 'previous' ? 'before' : 'after'} ${date}; ` +
      'check the business-hours schedule and holidays.'
  );
}
