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

/** What it takes to turn a schedule into dated occurrences; every view of a schedule starts here. */
export interface ScheduleShape {
  rule: RecurrenceRule;
  startDate: string;
  createTime: string;
  dueTime: string;
  leadDays: number;
  policy: NonBusinessDayPolicy;
  calendar: BusinessDayCalendar | null;
  timeZone: string;
}

/**
 * How far business-day adjustment can move a date. Enumeration windows are padded by this because an
 * adjusted due date can land on the other side of a window edge from its nominal date: 2 days is
 * enough for `keep`; for `previous`/`next` the pad is the longest walk.
 */
export function scheduleWindowPad(policy: NonBusinessDayPolicy): number {
  return policy === 'keep' ? 2 : MAX_BUSINESS_DAY_WALK;
}

/**
 * Every occurrence whose nominal date lies in `from..to` (local dates), adjusted for non-business
 * days, with its create and due instants. The views below differ only in which of these they keep.
 */
export function enumerateScheduleOccurrences(schedule: ScheduleShape, from: string, to: string): Candidate[] {
  const nominalDates = listOccurrenceDates(schedule.rule, schedule.startDate, { from, to });
  const adjusted = schedule.policy === 'keep'
    ? adjustForNonBusinessDays(nominalDates, 'keep', { isBusinessDay: () => true })
    : adjustForNonBusinessDays(nominalDates, schedule.policy, requireCalendar(schedule.calendar));

  return adjusted.map(({ nominal, due }) => ({
    nominal,
    due,
    createAt: toZonedInstant(addDays(due, -schedule.leadDays), schedule.createTime, schedule.timeZone),
    dueAt: toZonedInstant(due, schedule.dueTime, schedule.timeZone),
  }));
}

/**
 * The candidate occurrences of one definition-client (plan §4.4 step 2): every `{nominal, due}` date
 * whose create time has arrived and whose due time is after the watermark.
 */
export function listCandidateOccurrences(args: ScheduleShape & { evaluatedThrough: Date; now: Date }): Candidate[] {
  const pad = scheduleWindowPad(args.policy);
  const from = addDays(toLocalDateString(args.evaluatedThrough, args.timeZone), -pad);
  const to = addDays(toLocalDateString(args.now, args.timeZone), args.leadDays + pad);

  return enumerateScheduleOccurrences(args, from, to).filter(
    (candidate) =>
      candidate.createAt.getTime() <= args.now.getTime() &&
      candidate.dueAt.getTime() > args.evaluatedThrough.getTime()
  );
}

/**
 * The occurrences whose adjusted due date (a local `YYYY-MM-DD`) lies in `fromDate..toDate`, whether or
 * not the generator has created them yet. The `ticket.due_date` date trigger uses it to see a recurring
 * ticket's due date before the ticket exists, so a reminder never depends on `lead_days`.
 */
export function listOccurrencesDueBetween(args: ScheduleShape & { fromDate: string; toDate: string }): Candidate[] {
  const pad = scheduleWindowPad(args.policy);
  return enumerateScheduleOccurrences(args, addDays(args.fromDate, -pad), addDays(args.toDate, pad)).filter(
    (candidate) => candidate.due >= args.fromDate && candidate.due <= args.toDate
  );
}

function requireCalendar(calendar: BusinessDayCalendar | null): BusinessDayCalendar {
  if (!calendar) throw new Error('Business-day calendar was not loaded for a non-business-day policy');
  return calendar;
}
