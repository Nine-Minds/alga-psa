import { addDays, toLocalDateString } from '@alga-psa/shared/lib/recurrence';
import { enumerateScheduleOccurrences, scheduleWindowPad, type Candidate, type ScheduleShape } from './candidateOccurrences';

/** Search horizons in days; a rare rule (e.g. yearly) widens the window instead of returning nothing. */
const HORIZONS_DAYS = [62, 400, 1500];

/**
 * The next `count` occurrences of a schedule whose due time is still ahead of `now`, in due order.
 *
 * This is what the list ("next due") and the editor preview show. It deliberately mirrors the
 * generator's view: an occurrence whose create time has passed but whose due time has not is
 * included, because the next sweep will create it (no-backfill is decided by the due time).
 */
export function listUpcomingOccurrences(args: ScheduleShape & { now: Date; count: number }): Candidate[] {
  const pad = scheduleWindowPad(args.policy);
  const today = toLocalDateString(args.now, args.timeZone);
  let upcoming: Candidate[] = [];

  for (const horizon of HORIZONS_DAYS) {
    upcoming = enumerateScheduleOccurrences(args, addDays(today, -pad), addDays(today, horizon + pad))
      .filter((candidate) => candidate.dueAt.getTime() > args.now.getTime())
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

    if (upcoming.length >= args.count) break;
  }

  return upcoming.slice(0, args.count);
}
