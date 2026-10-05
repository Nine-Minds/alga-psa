import { WEEKDAYS, type RecurrenceRule, type Weekday } from './rule';

/**
 * Minimal i18next-compatible translate function. Every call supplies an English `defaultValue`, so
 * the function also works without any translation resources loaded (server-side summaries, tests).
 */
export type DescribeTranslate = (
  key: string,
  options: { defaultValue: string } & Record<string, unknown>
) => string;

/** English-only translator: interpolates `{{var}}` into `defaultValue`. */
export const englishDescribeTranslate: DescribeTranslate = (_key, options) => {
  const { defaultValue, ...vars } = options;
  return defaultValue.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
};

const WEEKDAY_ENGLISH: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const MONTH_ENGLISH = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ORDINAL_ENGLISH: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', last: 'last' };

const PREFIX = 'recurring.rule';

function weekdayName(t: DescribeTranslate, weekday: Weekday): string {
  return t(`${PREFIX}.weekdays.${weekday}`, { defaultValue: WEEKDAY_ENGLISH[weekday] });
}

function join(t: DescribeTranslate, items: string[]): string {
  return items.join(t(`${PREFIX}.listSeparator`, { defaultValue: ', ' }));
}

function describeEnd(rule: RecurrenceRule, t: DescribeTranslate): string {
  switch (rule.end.type) {
    case 'never':
      return '';
    case 'onDate':
      return t(`${PREFIX}.endOnDate`, { defaultValue: ', until {{date}}', date: rule.end.date });
    case 'afterCount':
      return t(`${PREFIX}.endAfterCount`, {
        defaultValue: ', {{n}} times',
        n: rule.end.count,
      });
  }
}

/** Human summary of a rule, e.g. "Every 2 weeks on Monday, Thursday". Localized through `t`. */
export function describeRule(rule: RecurrenceRule, t: DescribeTranslate = englishDescribeTranslate): string {
  let base: string;
  switch (rule.frequency) {
    case 'daily':
      base = rule.weekdaysOnly
        ? t(`${PREFIX}.dailyWeekdays`, { defaultValue: 'Every weekday' })
        : rule.interval === 1
          ? t(`${PREFIX}.daily`, { defaultValue: 'Every day' })
          : t(`${PREFIX}.dailyEvery`, { defaultValue: 'Every {{n}} days', n: rule.interval });
      break;
    case 'weekly': {
      const days = join(
        t,
        WEEKDAYS.filter((day) => rule.weekdays.includes(day)).map((day) => weekdayName(t, day))
      );
      base =
        rule.interval === 1
          ? t(`${PREFIX}.weekly`, { defaultValue: 'Every week on {{days}}', days })
          : t(`${PREFIX}.weeklyEvery`, { defaultValue: 'Every {{n}} weeks on {{days}}', n: rule.interval, days });
      break;
    }
    case 'monthly': {
      const every =
        rule.interval === 1
          ? t(`${PREFIX}.everyMonth`, { defaultValue: 'Every month' })
          : t(`${PREFIX}.everyNMonths`, { defaultValue: 'Every {{n}} months', n: rule.interval });
      if (rule.on.type === 'dayOfMonth') {
        const day =
          rule.on.day === 'last'
            ? t(`${PREFIX}.lastDay`, { defaultValue: 'the last day' })
            : t(`${PREFIX}.dayOfMonth`, { defaultValue: 'day {{day}}', day: rule.on.day });
        base = t(`${PREFIX}.monthlyOnDay`, { defaultValue: '{{every}} on {{day}}', every, day });
      } else {
        const ordinal = t(`${PREFIX}.ordinals.${rule.on.nth}`, { defaultValue: ORDINAL_ENGLISH[String(rule.on.nth)] });
        base = t(`${PREFIX}.monthlyOnNthWeekday`, {
          defaultValue: '{{every}} on the {{ordinal}} {{weekday}}',
          every,
          ordinal,
          weekday: weekdayName(t, rule.on.weekday),
        });
      }
      break;
    }
    case 'yearly':
      base = t(`${PREFIX}.yearly`, {
        defaultValue: 'Every year on {{month}} {{day}}',
        month: t(`${PREFIX}.months.${rule.month}`, { defaultValue: MONTH_ENGLISH[rule.month - 1] }),
        day: rule.day,
      });
      break;
  }
  return base + describeEnd(rule, t);
}
