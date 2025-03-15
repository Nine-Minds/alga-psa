import { ITimePeriodSettings } from 'server/src/interfaces/timeEntry.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { ISO8601String } from 'server/src/types/types.d';
import { format, fromZonedTime, toZonedTime,  } from 'date-fns-tz';

export class TimePeriodSettings {
  static async getActiveSettings(): Promise<ITimePeriodSettings[]> {
    try {
      const {knex: db, tenant} = await createTenantKnex();

      if (!tenant) {
        throw new Error('Tenant context is required for time period settings operations');
      }

      const settings = await db<ITimePeriodSettings>('time_period_settings')
        .where('is_active', true)
        .andWhere('tenant_id', tenant)
        .orderBy('effective_from', 'desc');

      if (!settings.length) {
        console.warn(`No active time period settings found for tenant ${tenant}`);
      }

      return settings.map((setting):ITimePeriodSettings => ({
        ...setting,
        effective_from: this.toISO8601(setting.effective_from),
        effective_to: setting.effective_to ? this.toISO8601(setting.effective_to) : undefined,
        created_at: this.toISO8601(setting.created_at),
        updated_at: this.toISO8601(setting.updated_at)
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
