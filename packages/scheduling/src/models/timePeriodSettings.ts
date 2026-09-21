import { format, toZonedTime } from 'date-fns-tz';
import type { Knex } from 'knex';
import type { ISO8601String, ITimePeriodSettings } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';

export class TimePeriodSettings {
  static async getActiveSettings(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<ITimePeriodSettings[]> {
    try {
      const settings = await tenantDb(knexOrTrx, tenant).table<ITimePeriodSettings>('time_period_settings')
        .where('is_active', true)
        .orderBy('effective_from', 'desc');

      if (!settings.length) {
        console.warn(`No active time period settings found for tenant ${tenant}`);
      }

      return settings.map((setting): ITimePeriodSettings => ({
        ...setting,
        // Database NULL denotes an unused calendar component; native settings
        // interfaces use absent optional values rather than numeric nulls.
        start_day: setting.start_day ?? undefined,
        end_day: setting.end_day ?? undefined,
        start_month: setting.start_month ?? undefined,
        start_day_of_month: setting.start_day_of_month ?? undefined,
        end_month: setting.end_month ?? undefined,
        end_day_of_month: setting.end_day_of_month ?? undefined,
        effective_from: this.toISO8601(setting.effective_from),
        effective_to: setting.effective_to ? this.toISO8601(setting.effective_to) : undefined,
        created_at: this.toISO8601(setting.created_at),
        updated_at: this.toISO8601(setting.updated_at),
      }));
    } catch (error) {
      console.error(`Error getting active time period settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  private static toISO8601(date: Date | string): ISO8601String {
    if (typeof date === 'string') {
      date = new Date(date);
    }

    return format(toZonedTime(date, 'UTC'), "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") as ISO8601String;
  }
}
