import * as rrulePkg from 'rrule';
import type { Options as RRuleOptions } from 'rrule';
import { dateStringToUtcMs, utcMsToDateString } from './dates';
import { recurrenceRuleSchema, type RecurrenceRule, type Weekday } from './rule';

type RRuleConstructor = typeof import('rrule').RRule;

const rruleExports = rrulePkg as unknown as {
  RRule?: RRuleConstructor;
  default?: { RRule?: RRuleConstructor };
};

function resolveRRule(): RRuleConstructor {
  const resolved = rruleExports.RRule ?? rruleExports.default?.RRule;
  if (!resolved) {
    throw new Error('Unable to resolve RRule export from rrule package');
  }
  return resolved;
}

const RRule = resolveRRule();

const RRULE_WEEKDAY = {
  mon: RRule.MO,
  tue: RRule.TU,
  wed: RRule.WE,
  thu: RRule.TH,
  fri: RRule.FR,
  sat: RRule.SA,
  sun: RRule.SU,
} as const;

function toRRuleWeekday(weekday: Weekday) {
  return RRULE_WEEKDAY[weekday];
}

/**
 * Days 29–31 clamp to the month's last day instead of being skipped. rrule drops months that lack
 * the day, so for day >= 29 we ask for {day, last-day} and keep the earliest in each period
 * (bysetpos = 1): the day itself when it exists, otherwise the last day.
 */
function clampedMonthDay(day: number): Partial<Pick<RRuleOptions, 'bymonthday' | 'bysetpos'>> {
  if (day >= 29) {
    return { bymonthday: [day, -1], bysetpos: 1 };
  }
  return { bymonthday: [day] };
}

function buildRRuleOptions(rule: RecurrenceRule, startDate: string): Partial<RRuleOptions> {
  // Calendar dates are treated as floating UTC midnights so no server timezone is involved.
  const options: Partial<RRuleOptions> = {
    dtstart: new Date(dateStringToUtcMs(startDate)),
    wkst: RRule.MO,
  };

  switch (rule.frequency) {
    case 'daily':
      options.freq = RRule.DAILY;
      options.interval = rule.interval;
      if (rule.weekdaysOnly) {
        options.byweekday = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR];
      }
      break;
    case 'weekly':
      options.freq = RRule.WEEKLY;
      options.interval = rule.interval;
      options.byweekday = rule.weekdays.map(toRRuleWeekday);
      break;
    case 'monthly':
      options.freq = RRule.MONTHLY;
      options.interval = rule.interval;
      if (rule.on.type === 'dayOfMonth') {
        if (rule.on.day === 'last') {
          options.bymonthday = [-1];
        } else {
          Object.assign(options, clampedMonthDay(rule.on.day));
        }
      } else {
        const weekday = toRRuleWeekday(rule.on.weekday);
        options.byweekday = [weekday.nth(rule.on.nth === 'last' ? -1 : rule.on.nth)];
      }
      break;
    case 'yearly':
      options.freq = RRule.YEARLY;
      options.interval = 1;
      options.bymonth = [rule.month];
      Object.assign(options, clampedMonthDay(rule.day));
      break;
  }

  if (rule.end.type === 'onDate') {
    options.until = new Date(dateStringToUtcMs(rule.end.date));
  } else if (rule.end.type === 'afterCount') {
    options.count = rule.end.count;
  }

  return options;
}

/**
 * Nominal rule dates (before any business-day adjustment) in the inclusive window `[from, to]`.
 *
 * `afterCount` is counted from `startDate`, not from `from`, so the window never changes which
 * occurrences exist. Dates before `startDate` are never returned.
 */
export function listOccurrenceDates(
  rule: RecurrenceRule,
  startDate: string,
  window: { from: string; to: string }
): string[] {
  const parsed = recurrenceRuleSchema.parse(rule);
  const fromMs = Math.max(dateStringToUtcMs(window.from), dateStringToUtcMs(startDate));
  const toMs = dateStringToUtcMs(window.to);
  if (toMs < fromMs) return [];

  const rrule = new RRule(buildRRuleOptions(parsed, startDate) as RRuleOptions);
  return rrule
    .between(new Date(fromMs), new Date(toMs), true)
    .map((occurrence) => utcMsToDateString(occurrence.getTime()));
}
