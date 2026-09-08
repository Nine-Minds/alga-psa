import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import type { ITimePeriod, ITimePeriodSettings, ITimePeriodView } from '@alga-psa/types';
import { endOfConfiguredTimePeriod, isTimePeriodSettingApplicable } from './timePeriodCadence';

export type TimePeriodSettings = ITimePeriodSettings;

export class TimePeriodSuggester {
  private static parseDateValue(value: string | Temporal.PlainDate): Temporal.PlainDate {
    return value instanceof Temporal.PlainDate ? value : Temporal.PlainDate.from(value.split('T')[0]);
  }

  static suggestNewTimePeriod(settings: TimePeriodSettings[], existingPeriods: ITimePeriod[] = [], today = Temporal.Now.plainDateISO()
  ): { success: boolean; data?: ITimePeriodView; error?: string; errorKey?: string } {
    const latest = existingPeriods.reduce<ITimePeriod | undefined>((found, period) => !found ||
      Temporal.PlainDate.compare(this.parseDateValue(period.end_date), this.parseDateValue(found.end_date)) > 0 ? period : found, undefined);
    const start = latest ? this.parseDateValue(latest.end_date) : today;
    const setting = settings.find(setting => isTimePeriodSettingApplicable(start, setting));
    if (!setting) return { success: false, error: 'No applicable time period settings found.', errorKey: 'timeEntry.periods.errors.noApplicableSettings' };
    return { success: true, data: { period_id: latest?.period_id ?? uuidv4(), tenant: setting.tenant,
      start_date: start.toString(), end_date: endOfConfiguredTimePeriod(start, setting).toString() } };
  }

  static calculateEndDate(startDate: Temporal.PlainDate, settings: TimePeriodSettings): Temporal.PlainDate {
    return endOfConfiguredTimePeriod(startDate, settings);
  }
}
