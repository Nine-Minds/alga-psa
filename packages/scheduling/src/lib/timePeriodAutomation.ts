import type { Knex } from 'knex';
import type { ITimePeriod } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { tenantDb } from '@alga-psa/db';
import { withTimePeriodJob, type TimePeriodJobIdentity } from '@alga-psa/co-managed';
import { TimePeriod } from '../models/timePeriod';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { TimePeriodSuggester } from './timePeriodSuggester';

/** Only the job registration imports this worker module. It accepts no caller
 * settings, session override, or tenant from ambient browser context. */
export async function createNextTimePeriod(db: Knex, identity: TimePeriodJobIdentity, daysThreshold = 5) {
  if (!Number.isSafeInteger(daysThreshold) || daysThreshold < 0 || daysThreshold > 365) throw new Error('Invalid time period creation horizon');
  return withTimePeriodJob(db, identity, async trx => {
    const owner = tenantDb(trx, identity.tenant);
    await owner.table('time_period_settings').where('is_active', true).orderBy('time_period_settings_id').forShare().select('time_period_settings_id');
    const settings = await TimePeriodSettings.getActiveSettings(trx, identity.tenant);
    if (!settings.length) return { period: null, createdCount: 0, reason: 'No active time period settings' };
    const periods = await TimePeriod.getAll(trx, identity.tenant), today = Temporal.Now.plainDateISO('UTC');
    let latest = periods.reduce<Temporal.PlainDate | null>((end, period) => {
      const date = Temporal.PlainDate.from(period.end_date.toString());
      return end === null || Temporal.PlainDate.compare(date, end) > 0 ? date : end;
    }, null);
    let period: ITimePeriod | null = null;
    let createdCount = 0;
    while (createdCount < 52 && (!latest || latest.since(today, { largestUnit: 'day' }).days <= daysThreshold)) {
      const suggestion = TimePeriodSuggester.suggestNewTimePeriod(settings, periods, today);
      if (!suggestion.success || !suggestion.data) break;
      period = await TimePeriod.create(trx, identity.tenant, {
        start_date: Temporal.PlainDate.from(suggestion.data.start_date), end_date: Temporal.PlainDate.from(suggestion.data.end_date),
      });
      periods.push(period); latest = Temporal.PlainDate.from(period.end_date.toString()); createdCount++;
    }
    return { period, createdCount, reason: createdCount ? 'Created time periods' : 'No new time period needed' };
  });
}
