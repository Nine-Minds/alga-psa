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

export interface Candidate {
  nominal: string;
  due: string;
  createAt: Date;
  dueAt: Date;
}

/**
 * The candidate occurrences of one definition-client (plan §4.4 step 2): every `{nominal, due}` date
 * whose create time has arrived and whose due time is after the watermark.
 *
 * The enumeration window is padded because business-day adjustment can move a date across the
 * window edge: 2 days is enough for `keep`; for `previous`/`next` the pad is the longest walk.
 */
export function listCandidateOccurrences(args: {
  rule: RecurrenceRule;
  startDate: string;
  createTime: string;
  dueTime: string;
  leadDays: number;
  policy: NonBusinessDayPolicy;
  calendar: BusinessDayCalendar | null;
  evaluatedThrough: Date;
  now: Date;
  timeZone: string;
}): Candidate[] {
  const pad = args.policy === 'keep' ? 2 : MAX_BUSINESS_DAY_WALK;
  const from = addDays(toLocalDateString(args.evaluatedThrough, args.timeZone), -pad);
  const to = addDays(toLocalDateString(args.now, args.timeZone), args.leadDays + pad);

  const nominalDates = listOccurrenceDates(args.rule, args.startDate, { from, to });
  const adjusted = args.policy === 'keep'
    ? adjustForNonBusinessDays(nominalDates, 'keep', { isBusinessDay: () => true })
    : adjustForNonBusinessDays(nominalDates, args.policy, requireCalendar(args.calendar));

  return adjusted
    .map(({ nominal, due }) => ({
      nominal,
      due,
      createAt: toZonedInstant(addDays(due, -args.leadDays), args.createTime, args.timeZone),
      dueAt: toZonedInstant(due, args.dueTime, args.timeZone),
    }))
    .filter(
      (candidate) =>
        candidate.createAt.getTime() <= args.now.getTime() &&
        candidate.dueAt.getTime() > args.evaluatedThrough.getTime()
    );
}

function requireCalendar(calendar: BusinessDayCalendar | null): BusinessDayCalendar {
  if (!calendar) throw new Error('Business-day calendar was not loaded for a non-business-day policy');
  return calendar;
}

