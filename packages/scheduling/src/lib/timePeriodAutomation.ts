import type { Knex } from 'knex';
import type { ITimePeriod } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { tenantDb } from '@alga-psa/db';
import { withTimePeriodJob, type TimePeriodJobIdentity } from '@alga-psa/co-managed';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { createTimePeriodsThrough } from './timePeriodMaterialization';

/** Only the job registration imports this worker module. It accepts no caller
 * settings, session override, or tenant from ambient browser context. The job
 * fence is this module's; generation is the shared materializer's, so the job,
 * the nightly maintenance run and on-demand creation fill periods identically. */
export async function createNextTimePeriod(db: Knex, identity: TimePeriodJobIdentity, daysThreshold = 5) {
  if (!Number.isSafeInteger(daysThreshold) || daysThreshold < 0 || daysThreshold > 365) throw new Error('Invalid time period creation horizon');
  return withTimePeriodJob(db, identity, async trx => {
    const owner = tenantDb(trx, identity.tenant);
    await owner.table('time_period_settings').where('is_active', true).orderBy('time_period_settings_id').forShare().select('time_period_settings_id');
    const settings = await TimePeriodSettings.getActiveSettings(trx, identity.tenant);
    if (!settings.length) return { period: null as ITimePeriod | null, createdCount: 0, reason: 'No active time period settings' };
    const countPeriods = async () => Number((await owner.table('time_periods').count<{ count: string }[]>('* as count'))[0]?.count ?? 0);
    const before = await countPeriods();
    const period = await createTimePeriodsThrough(trx, identity.tenant, settings, Temporal.Now.plainDateISO('UTC'), daysThreshold);
    const createdCount = (await countPeriods()) - before;
    return { period, createdCount, reason: createdCount ? 'Created time periods' : 'No new time period needed' };
  });
}
