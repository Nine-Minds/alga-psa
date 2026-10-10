import {
  MAX_BUSINESS_DAY_WALK,
  addDays,
  adjustForNonBusinessDays,
  listOccurrenceDates,
  toLocalDateString,
  toZonedInstant,
  type NonBusinessDayPolicy,
  type RecurrenceRule,
} from '@alga-psa/shared/lib/recurrence';
import type { BusinessDayCalendar } from '@alga-psa/shared/lib/businessHours/businessDayCalendar';
import type { Candidate } from './candidateOccurrences';

/** Search horizons in days; a rare rule (e.g. yearly) widens the window instead of returning nothing. */
const HORIZONS_DAYS = [62, 400, 1500];

/**
 * The next `count` occurrences of a schedule whose due time is still ahead of `now`, in due order.
 *
 * This is what the list ("next due") and the editor preview show. It deliberately mirrors the
 * generator's view: an occurrence whose create time has passed but whose due time has not is
 * included, because the next sweep will create it (no-backfill is decided by the due time).
 */
export function listUpcomingOccurrences(args: {
  rule: RecurrenceRule;
  startDate: string;
  createTime: string;
  dueTime: string;
  leadDays: number;
  policy: NonBusinessDayPolicy;
  calendar: BusinessDayCalendar | null;
  now: Date;
  timeZone: string;
  count: number;
}): Candidate[] {
  const pad = args.policy === 'keep' ? 2 : MAX_BUSINESS_DAY_WALK;
  const today = toLocalDateString(args.now, args.timeZone);
  let upcoming: Candidate[] = [];

  for (const horizon of HORIZONS_DAYS) {
    const nominalDates = listOccurrenceDates(args.rule, args.startDate, {
      from: addDays(today, -pad),
      to: addDays(today, horizon + pad),
    });
    const adjusted = args.policy === 'keep'
      ? adjustForNonBusinessDays(nominalDates, 'keep', { isBusinessDay: () => true })
      : adjustForNonBusinessDays(nominalDates, args.policy, requireCalendar(args.calendar));

    upcoming = adjusted
      .map(({ nominal, due }) => ({
        nominal,
        due,
        createAt: toZonedInstant(addDays(due, -args.leadDays), args.createTime, args.timeZone),
        dueAt: toZonedInstant(due, args.dueTime, args.timeZone),
      }))
      .filter((candidate) => candidate.dueAt.getTime() > args.now.getTime())
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    if (upcoming.length >= args.count) break;
  }

  return upcoming.slice(0, args.count);
}

function requireCalendar(calendar: BusinessDayCalendar | null): BusinessDayCalendar {
  if (!calendar) throw new Error('Business-day calendar is required for a non-business-day policy');
  return calendar;
}
