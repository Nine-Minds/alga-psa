import { dateValueToDate, toPlainDate } from '@alga-psa/core';
import { z } from 'zod';

type PlainDate = ReturnType<typeof toPlainDate>;

export const MAINTENANCE_RECURRENCE_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type MaintenanceRecurrenceUnit = (typeof MAINTENANCE_RECURRENCE_UNITS)[number];

const uniqueIntegers = (min: number, max: number) =>
  z.array(z.number().int().min(min).max(max)).min(1)
    .refine((values) => new Set(values).size === values.length, { message: 'values must be unique' });

/**
 * Rule for `frequency: 'custom'`, stored at `schedule_config.recurrence`. The
 * multiplier is the schedule's `frequency_interval`, so "every 2 weeks on
 * Mon/Thu" is `frequency_interval: 2` + `{ unit: 'weeks', weekdays: [1, 4] }`.
 */
export const customRecurrenceSchema = z.object({
  unit: z.enum(MAINTENANCE_RECURRENCE_UNITS),
  // 0 = Sunday … 6 = Saturday; weeks only.
  weekdays: uniqueIntegers(0, 6).optional(),
  // 1–31, clamped to the month length; months only.
  days_of_month: uniqueIntegers(1, 31).optional(),
}).strict().superRefine((rule, ctx) => {
  if (rule.weekdays && rule.unit !== 'weeks') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekdays'], message: 'weekdays only applies to unit "weeks"' });
  }
  if (rule.days_of_month && rule.unit !== 'months') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['days_of_month'], message: 'days_of_month only applies to unit "months"' });
  }
});
export type CustomRecurrence = z.infer<typeof customRecurrenceSchema>;

export const CUSTOM_RECURRENCE_REQUIRED =
  'Custom maintenance frequency requires schedule_config.recurrence ({ unit: "days" | "weeks" | "months" | "years", weekdays?, days_of_month? })';

/** Reads the custom rule out of schedule_config; throws when it is missing or invalid. */
export function parseCustomRecurrence(scheduleConfig: unknown): CustomRecurrence {
  const recurrence = scheduleConfig && typeof scheduleConfig === 'object'
    ? (scheduleConfig as Record<string, unknown>).recurrence
    : undefined;
  if (recurrence === undefined || recurrence === null) throw new Error(CUSTOM_RECURRENCE_REQUIRED);
  const result = customRecurrenceSchema.safeParse(recurrence);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'recurrence'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid custom maintenance recurrence: ${detail}`);
  }
  return result.data;
}

/** Weeks start on Sunday; months clamp listed days to the month length. */
function advanceCustom(date: PlainDate, interval: number, rule: CustomRecurrence): PlainDate {
  switch (rule.unit) {
    case 'days': return date.add({ days: interval });
    case 'years': return date.add({ years: interval });
    case 'weeks': {
      if (!rule.weekdays) return date.add({ weeks: interval });
      const weekdays = [...rule.weekdays].sort((a, b) => a - b);
      const weekday = date.dayOfWeek % 7; // Temporal 1=Mon…7=Sun -> 0=Sun…6=Sat
      const later = weekdays.find((candidate) => candidate > weekday);
      if (later !== undefined) return date.add({ days: later - weekday });
      return date.subtract({ days: weekday }).add({ weeks: interval, days: weekdays[0] });
    }
    case 'months': {
      if (!rule.days_of_month) return date.add({ months: interval });
      const days = [...rule.days_of_month].sort((a, b) => a - b);
      const later = days.map((day) => Math.min(day, date.daysInMonth)).find((day) => day > date.day);
      if (later !== undefined) return date.with({ day: later });
      const target = date.with({ day: 1 }).add({ months: interval });
      return target.with({ day: Math.min(days[0], target.daysInMonth) });
    }
  }
}

/**
 * Computes the next maintenance date from the actual event date. Month-based
 * intervals clamp to the end of the target month (for example Jan 31 → Feb 28).
 * `custom` reads its rule from `scheduleConfig.recurrence`.
 */
export function advanceMaintenanceDate(
  performedAt: string | Date,
  frequency: string,
  interval: number,
  scheduleConfig?: unknown,
): Date {
  if (!Number.isInteger(interval) || interval < 1) throw new Error('Maintenance frequency interval must be at least one');
  const customRule = frequency === 'custom' ? parseCustomRecurrence(scheduleConfig) : null;
  // Legacy API callers can still send an instant; preserve its time-of-day
  // after doing the recurrence arithmetic on the calendar date. Plain dates
  // intentionally have no time component and return canonical UTC midnight.
  const sourceInstant = performedAt instanceof Date
    ? performedAt
    : performedAt.includes('T') || performedAt.includes('Z')
      ? dateValueToDate(performedAt)
      : null;
  let date;
  try {
    date = toPlainDate(performedAt);
  } catch {
    throw new Error('Invalid maintenance completion date');
  }
  if (customRule) date = advanceCustom(date, interval, customRule);
  else if (frequency === 'daily') date = date.add({ days: interval });
  else if (frequency === 'weekly') date = date.add({ days: interval * 7 });
  else if (frequency === 'monthly') date = date.add({ months: interval });
  else if (frequency === 'quarterly') date = date.add({ months: interval * 3 });
  else if (frequency === 'yearly') date = date.add({ years: interval });
  else throw new Error(`Unsupported maintenance frequency: ${frequency}`);
  const result = dateValueToDate(date);
  if (sourceInstant && !Number.isNaN(sourceInstant.getTime())) {
    result.setUTCHours(sourceInstant.getUTCHours(), sourceInstant.getUTCMinutes(), sourceInstant.getUTCSeconds(), sourceInstant.getUTCMilliseconds());
  }
  return result;
}
