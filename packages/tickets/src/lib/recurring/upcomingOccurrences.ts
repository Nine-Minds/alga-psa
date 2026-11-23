import { addDays, listNextOccurrenceDates, toLocalDateString } from '@alga-psa/shared/lib/recurrence';
import { enumerateScheduleOccurrences, scheduleWindowPad, type Candidate, type ScheduleShape } from './candidateOccurrences';

/**
 * The next `count` occurrences of a schedule whose due time is still ahead of `now`, in due order.
 *
 * This is what the list ("next due") and the editor preview show. It deliberately mirrors the
 * generator's view: an occurrence whose create time has passed but whose due time has not is
 * included, because the next sweep will create it (no-backfill is decided by the due time).
 *
 * The search is driven by the rule itself rather than a fixed horizon, so a rare rule (yearly, or one
 * starting years out) still yields `count` occurrences; fewer come back only when the rule ends.
 */
export function listUpcomingOccurrences(args: ScheduleShape & { now: Date; count: number }): Candidate[] {
  if (args.count <= 0) return [];
  const pad = scheduleWindowPad(args.policy);
  const from = addDays(toLocalDateString(args.now, args.timeZone), -pad);

  for (let wanted = args.count + 2 * pad; ; wanted *= 2) {
    const nominalDates = listNextOccurrenceDates(args.rule, args.startDate, { from, count: wanted });
    if (nominalDates.length === 0) return [];

    const to = nominalDates[nominalDates.length - 1];
    const ruleExhausted = nominalDates.length < wanted;
    // Business-day adjustment can move a later nominal date up to `pad` days earlier, so only due
    // dates at least `pad` days before the last enumerated nominal date are known to be complete.
    const settledThrough = ruleExhausted ? null : addDays(to, -pad);

    const upcoming = enumerateScheduleOccurrences(args, from, to)
      .filter((candidate) => candidate.dueAt.getTime() > args.now.getTime())
      .filter((candidate) => settledThrough === null || candidate.due <= settledThrough)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    if (upcoming.length >= args.count || ruleExhausted) return upcoming.slice(0, args.count);
  }
}
