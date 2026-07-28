/**
 * Work-schedule math shared by the schedule editor, the server action and the
 * utilization report.
 *
 * Lives in `core` rather than next to the scheduling actions that own the table,
 * because `reporting` needs it too and `scheduling -> clients -> reporting` is a
 * real edge: importing it from `scheduling` closed that loop into a dependency
 * cycle. `core` is a leaf both sides already depend on. Nothing here touches the
 * database or React, so it stays a leaf as well — keep it that way.
 *
 * A work schedule says when someone is on the clock. It is not the same thing as
 * `availability_settings`, which says when a client may book them — a
 * dispatch-only technician works full days and publishes no bookable hours.
 *
 * `resources.availability` used to be a third, nameless version of the same
 * idea: an unvalidated jsonb blob with no readers anywhere in the repo and a
 * single writer, the dev seed. It was dropped rather than repurposed
 * (20260728120000_drop_resources_availability), because a column that already
 * carries the word "availability" is exactly how a work schedule and a booking
 * window get merged back together the next time someone needs somewhere to put
 * working hours. Nothing was kept: the only row it ever held in production was
 * the seed's own.
 *
 * Not modelled here, deliberately:
 *  - PTO and holidays. They need their own leave calendar;
 *    `availability_exceptions` is a booking concept and would repeat the same
 *    conflation.
 *  - Effective dating. A schedule edited today retroactively changes what last
 *    quarter's capacity looks like. Rows, not a blob, is what makes adding it
 *    later a migration rather than a rewrite.
 */

export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export interface WorkScheduleDay {
  dayOfWeek: DayOfWeek;
  isWorking: boolean;
  /** 'HH:MM' or 'HH:MM:SS' in the user's own working day. */
  startTime: string;
  endTime: string;
}

export type WorkScheduleRejection = 'bad_day' | 'bad_time' | 'inverted_window' | 'duplicate_day';

export type ParsedWorkSchedule =
  | { ok: true; value: WorkScheduleDay[] }
  | { ok: false; reason: WorkScheduleRejection };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Hours in a single scheduled day, 0 when the person is off that day. */
export function dailyScheduledHours(day: WorkScheduleDay): number {
  if (!day.isWorking) return 0;
  const start = parseTimeToMinutes(day.startTime);
  const end = parseTimeToMinutes(day.endTime);
  if (start === null || end === null || end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

export function weeklyScheduledHours(days: WorkScheduleDay[]): number {
  return Math.round(days.reduce((sum, day) => sum + dailyScheduledHours(day), 0) * 10) / 10;
}

/**
 * Capacity across the actual calendar days in the range, rather than
 * `weekly * rangeDays / 7`.
 *
 * The approximation assumes every range contains whole identical weeks. A 7-day
 * range ending on a Friday covers five working days for a Mon-Fri schedule; one
 * ending on a Sunday covers five as well, but a 10-day range covers six or
 * seven depending on where it lands. Counting real weekdays is the only way the
 * denominator matches the `work_date` window the numerator is summed over.
 *
 * `rangeEndDate` is the inclusive last day, as 'YYYY-MM-DD'.
 */
export function scheduledHoursForRange(
  days: WorkScheduleDay[],
  rangeDays: number,
  rangeEndDate: string,
): number | null {
  if (days.length === 0) return null;
  if (!(rangeDays > 0)) return 0;

  const hoursByDay = new Map<number, number>();
  for (const day of days) {
    hoursByDay.set(day.dayOfWeek, dailyScheduledHours(day));
  }

  const end = new Date(`${rangeEndDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;

  let total = 0;
  for (let offset = 0; offset < rangeDays; offset += 1) {
    const day = new Date(end.getTime());
    day.setUTCDate(day.getUTCDate() - offset);
    total += hoursByDay.get(day.getUTCDay()) ?? 0;
  }
  return Math.round(total * 10) / 10;
}

/**
 * Validate a schedule coming from the editor before it is persisted, so a bad
 * window is rejected identically on both sides.
 */
export function parseWorkSchedule(input: unknown): ParsedWorkSchedule {
  if (!Array.isArray(input)) return { ok: false, reason: 'bad_day' };

  const seen = new Set<number>();
  const value: WorkScheduleDay[] = [];

  for (const raw of input) {
    const day = raw as Partial<WorkScheduleDay>;
    const dayOfWeek = Number(day?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { ok: false, reason: 'bad_day' };
    }
    if (seen.has(dayOfWeek)) return { ok: false, reason: 'duplicate_day' };
    seen.add(dayOfWeek);

    const start = parseTimeToMinutes(day?.startTime);
    const end = parseTimeToMinutes(day?.endTime);
    if (start === null || end === null) return { ok: false, reason: 'bad_time' };
    // Enforced even for non-working days: the row still has to satisfy the
    // table's CHECK (end_time > start_time).
    if (end <= start) return { ok: false, reason: 'inverted_window' };

    value.push({
      dayOfWeek: dayOfWeek as DayOfWeek,
      isWorking: Boolean(day?.isWorking),
      startTime: (day!.startTime as string).trim().slice(0, 5),
      endTime: (day!.endTime as string).trim().slice(0, 5),
    });
  }

  return { ok: true, value };
}

export function workScheduleRejectionMessage(reason: WorkScheduleRejection): string {
  switch (reason) {
    case 'bad_time':
      return 'Working hours must be times in HH:MM format';
    case 'inverted_window':
      return 'A working day must end after it starts';
    case 'duplicate_day':
      return 'Each day of the week can only appear once';
    default:
      return 'Working hours must be given for days 0 (Sunday) through 6 (Saturday)';
  }
}
