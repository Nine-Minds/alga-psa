import type { Knex } from 'knex';
import { withTimePeriodJob, type TimePeriodJobIdentity } from '@alga-psa/co-managed';
import { createNextTimePeriodsAdmitted } from './timePeriodMaterialization';

/** Queue-identity form of the nightly job: binds the retained `jobs` row on top of the same admission
 * fence the maintenance fan-out uses (withTimePeriodWriteAdmission) and generates through the same
 * shared body. It accepts no caller settings, session override, or tenant from ambient browser context. */
export async function createNextTimePeriod(db: Knex, identity: TimePeriodJobIdentity, daysThreshold = 5) {
  if (!Number.isSafeInteger(daysThreshold) || daysThreshold < 0 || daysThreshold > 365) throw new Error('Invalid time period creation horizon');
  return withTimePeriodJob(db, identity, trx => createNextTimePeriodsAdmitted(trx, identity.tenant, daysThreshold));
}
