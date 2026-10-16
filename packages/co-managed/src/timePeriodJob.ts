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

export type TimePeriodWriteOutcome<T> = { status: 'completed'; result: T } | { status: 'skipped'; reason: string };

/** Lifecycle admission and the period write in ONE transaction. The sponsor
 * entitlement row is locked FOR UPDATE and the tenant/relationship rows FOR
 * SHARE by the admission read, and the calendar lock is taken before any
 * period row is touched, so a sponsor that goes read-only mid-run either waits
 * for this transaction or, if it won first, is seen by the final re-check and
 * rolls every generated period back. Both the queue-identity job below and the
 * maintenance fan-out (CE pg-boss and EE Temporal) run through this one fence.
 *
 * `afterRead` runs once the lifecycle and workspace rows are read and before
 * any skip decision; `beforeCommit` runs after `work`, before the final
 * lifecycle re-check. Either may throw to abort and roll back. */
export async function withTimePeriodWriteAdmission<T>(
  db: Knex,
  tenant: string,
  work: (trx: Knex.Transaction) => Promise<T>,
  hooks: { afterRead?: (trx: Knex.Transaction) => Promise<void>; beforeCommit?: (trx: Knex.Transaction) => Promise<void> } = {},
): Promise<TimePeriodWriteOutcome<T>> {
  return withTransaction(db, async trx => {
    const state = await getCoManagedOperationalState(trx, tenant), owner = tenantDb(trx, tenant);
    const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    if (hooks.afterRead) await hooks.afterRead(trx);
    if (!workspace) throw new Error('Workspace not found for time period creation');
    if (workspace.suspended_at) return { status: 'skipped', reason: 'Workspace suspended' } as const;
    if (!productTimeEntryMode(workspace.product_code)) return { status: 'skipped', reason: 'Time tracking is unavailable for this product' } as const;
    if (!state.canWrite) return { status: 'skipped', reason: `Co-management ${state.state}` } as const;
    await assertCoManagedOperationalWrite(trx, tenant);
    await lockTimePeriodCalendar(trx, tenant);
    const result = await work(trx);
    if (hooks.beforeCommit) await hooks.beforeCommit(trx);
    await assertCoManagedOperationalWrite(trx, tenant);
    return { status: 'completed', result } as const;
  });
}

/** Trusted worker boundary, deliberately outside every server-action module.
 * A tenant hint or a human/API credential cannot stand in for this specific
 * system job. The worker supplies the queue ID, matched to its retained row. */
export async function withTimePeriodJob<T>(db: Knex, input: TimePeriodJobIdentity, work: (trx: Knex.Transaction) => Promise<T>
): Promise<TimePeriodWriteOutcome<T>> {
  const identity = { ...input };
  if (![identity.tenant, identity.jobId, identity.scheduledJobId].every(isCoManagedUuid)) throw new TimePeriodJobError();
  const owner = (trx: Knex.Transaction) => tenantDb(trx, identity.tenant);
  const assertJob = async (trx: Knex.Transaction, lock: boolean) => {
    const query = owner(trx).table('jobs').where({ job_id: identity.jobId, type: 'createNextTimePeriods', status: 'processing' }).whereNull('user_id');
    if (lock) query.forShare();
    const job = await query.first('metadata');
    let metadata;
    try { metadata = typeof job?.metadata === 'string' ? JSON.parse(job.metadata) : job?.metadata; } catch { throw new TimePeriodJobError(); }
    if (!job || metadata?.triggeredBy !== 'scheduler' || metadata?.scheduledJobId !== identity.scheduledJobId) throw new TimePeriodJobError();
  };
  return withTimePeriodWriteAdmission(db, identity.tenant, work, {
    afterRead: trx => assertJob(trx, true),
    beforeCommit: trx => assertJob(trx, false),
  });
}
