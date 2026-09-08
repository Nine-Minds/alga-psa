import { Temporal } from '@js-temporal/polyfill';
import type { ITimePeriodSettings } from '@alga-psa/types';

const date = (value: string) => Temporal.PlainDate.from(value.slice(0, 10));

/** end_day and end_day_of_month are exclusive boundaries; zero denotes the
 * first day after the configured month. Every consumer uses this convention. */
export function endOfConfiguredTimePeriod(start: Temporal.PlainDate, setting: ITimePeriodSettings): Temporal.PlainDate {
  const frequency = setting.frequency;
  if (!Number.isSafeInteger(frequency) || frequency < 1) throw new Error('Frequency must be a positive integer');
  let end: Temporal.PlainDate;
  switch (setting.frequency_unit) {
    case 'day': end = start.add({ days: frequency }); break;
    case 'week': end = start.add({ weeks: frequency }); break;
    case 'month': {
      const month = start.with({ day: 1 }).add({ months: frequency - 1 });
      end = setting.end_day ? month.with({ day: Math.min(setting.end_day, month.daysInMonth) }) : month.add({ months: 1 });
      break;
    }
    case 'year': {
      const month = Temporal.PlainDate.from({ year: start.year + frequency - 1, month: setting.end_month ?? 12, day: 1 });
      end = setting.end_day_of_month ? month.with({ day: Math.min(setting.end_day_of_month, month.daysInMonth) }) : month.add({ months: 1 });
      if (Temporal.PlainDate.compare(end, start) <= 0) end = end.add({ years: 1 });
      break;
    }
    default: throw new Error('Invalid frequency unit');
  }
  if (Temporal.PlainDate.compare(end, start) <= 0) throw new Error('Time period settings must advance the calendar');
  return end;
}

export function isTimePeriodSettingApplicable(start: Temporal.PlainDate, setting: ITimePeriodSettings) {
  if (!setting.is_active || Temporal.PlainDate.compare(start, date(setting.effective_from)) < 0 ||
      (setting.effective_to && Temporal.PlainDate.compare(start, date(setting.effective_to)) >= 0)) return false;
  if (setting.frequency_unit === 'month') {
    if (start.day < Math.min(setting.start_day ?? 1, start.daysInMonth) || (setting.end_day && start.day >= Math.min(setting.end_day, start.daysInMonth))) return false;
  } else if (setting.frequency_unit === 'week') {
    if (start.dayOfWeek < (setting.start_day ?? 1) || start.dayOfWeek > (setting.end_day || 7)) return false;
  } else if (setting.frequency_unit === 'year') {
    const firstMonth = Temporal.PlainDate.from({ year: start.year, month: setting.start_month ?? 1, day: 1 });
    const lastMonth = Temporal.PlainDate.from({ year: start.year, month: setting.end_month ?? 12, day: 1 });
    const position = start.month * 32 + start.day, first = firstMonth.month * 32 + Math.min(setting.start_day_of_month ?? 1, firstMonth.daysInMonth),
      last = lastMonth.month * 32 + (setting.end_day_of_month ? Math.min(setting.end_day_of_month, lastMonth.daysInMonth) : 32);
    if (last > first ? position < first || position >= last : position < first && position >= last) return false;
  }
  const end = endOfConfiguredTimePeriod(start, setting);
  return !setting.effective_to || Temporal.PlainDate.compare(end, date(setting.effective_to)) <= 0;
}
