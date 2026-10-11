import type { Knex } from 'knex';
import { tenantDb, withTransaction, lockTimePeriodCalendar } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { isCoManagedUuid } from './sharedWorkIdentity';

export class TimePeriodJobError extends Error {
  readonly code = 'TIME_PERIOD_JOB_FORBIDDEN';
  constructor() { super('The time period worker requires its current processing job'); this.name = 'TimePeriodJobError'; }
}

export interface TimePeriodJobIdentity { tenant: string; jobId: string; scheduledJobId: string }

/** Trusted worker boundary, deliberately outside every server-action module.
 * A tenant hint or a human/API credential cannot stand in for this specific
 * system job. The worker supplies the queue ID, matched to its retained row. */
export async function withTimePeriodJob<T>(db: Knex, input: TimePeriodJobIdentity, work: (trx: Knex.Transaction) => Promise<T>
): Promise<{ status: 'completed'; result: T } | { status: 'skipped'; reason: string }> {
  const identity = { ...input };
  if (![identity.tenant, identity.jobId, identity.scheduledJobId].every(isCoManagedUuid)) throw new TimePeriodJobError();
  return withTransaction(db, async trx => {
    const state = await getCoManagedOperationalState(trx, identity.tenant), owner = tenantDb(trx, identity.tenant);
    const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const jobQuery = () => owner.table('jobs').where({ job_id: identity.jobId, type: 'createNextTimePeriods', status: 'processing' }).whereNull('user_id');
    const assertJob = async (lock: boolean) => {
      const query = jobQuery(); if (lock) query.forShare();
      const job = await query.first('metadata');
      let metadata;
      try { metadata = typeof job?.metadata === 'string' ? JSON.parse(job.metadata) : job?.metadata; } catch { throw new TimePeriodJobError(); }
      if (!job || metadata?.triggeredBy !== 'scheduler' || metadata?.scheduledJobId !== identity.scheduledJobId) throw new TimePeriodJobError();
    };
    await assertJob(true);
    if (!workspace) throw new TimePeriodJobError();
    if (workspace.suspended_at) return { status: 'skipped', reason: 'Workspace suspended' };
    if (!productTimeEntryMode(workspace.product_code)) return { status: 'skipped', reason: 'Time tracking is unavailable for this product' };
    if (!state.canWrite) return { status: 'skipped', reason: `Co-management ${state.state}` };
    await assertCoManagedOperationalWrite(trx, identity.tenant);
    await lockTimePeriodCalendar(trx, identity.tenant);
    const result = await work(trx);
    await assertJob(false); await assertCoManagedOperationalWrite(trx, identity.tenant);
    return { status: 'completed', result };
  });
}
