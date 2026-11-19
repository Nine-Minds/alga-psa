import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, lockCoManagedSponsorPool, type HostedCoManagedSnapshot } from '@alga-psa/licensing';

export interface SeatTrialQuote {
  quantity: number;
  monthlyTotal: number;
  amountDue: number;
  currency: string;
}

async function boundPilot(trx: Knex.Transaction, tenant: string, trialId: string) {
  const db = tenantDb(trx, tenant);
  const query = db.table('co_managed_seat_trials as p').where('p.trial_id', trialId)
    .whereIn('p.state', ['active', 'expired', 'pending']);
  db.tenantJoin(query, 'co_managed_allocations as f', 'f.allocation_id', 'p.allocation_id');
  db.tenantJoin(query, 'co_managed_seat_arrangements as r', 'r.arrangement_id', 'p.arrangement_id');
  db.tenantJoin(query, 'co_managed_seat_assignments as a', 'a.assignment_id', 'p.assignment_id');
  return query.where({ 'f.funding_source': 'seat_trial', 'f.state': 'active', 'r.state': 'active' })
    .where('r.allocation_id', trx.ref('f.allocation_id')).where('a.arrangement_id', trx.ref('r.arrangement_id'))
    .whereIn('a.state', ['invited', 'active']).first('p.*');
}

async function handoff(trx: Knex.Transaction, tenant: string, trialId: string) {
  const db = tenantDb(trx, tenant);
  const pilot = await boundPilot(trx, tenant, trialId);
  if (!pilot) return false;
  const pool = await getCoManagedEntitlementState(trx, tenant);
  const base = await db.table('co_managed_trial_sponsors').where('base_until', '>', trx.fn.now()).first('tenant');
  if (!pool.canGrow || !base) return false;
  await db.table('co_managed_allocations').where({ allocation_id: pilot.allocation_id }).update({ funding_source: 'paid' });
  await db.table('co_managed_seat_trials').where({ trial_id: trialId })
    .update({ state: 'paid', conversion_state: 'paid', updated_at: trx.fn.now() });
  if (pilot.activated_at) await db.table('co_managed_seat_trial_milestones').insert({ tenant, trial_id: trialId, milestone: 'converted' })
    .onConflict(['tenant', 'trial_id', 'milestone']).ignore();
  return true;
}

export async function usePaidSeatForTrial(db: Knex, tenant: string, trialId: string, allocationId?: string) {
  await db.transaction(async trx => {
    await lockCoManagedSponsorPool(trx, tenant);
    const pilot = await tenantDb(trx, tenant).table('co_managed_seat_trials').where({ trial_id: trialId }).first();
    if (allocationId && pilot?.allocation_id !== allocationId) throw new Error('Trial binding changed');
    if (pilot?.state === 'paid') return;
    if (!pilot || pilot.conversion_state === 'pending' || !await handoff(trx, tenant, trialId)) {
      throw new Error('Available paid capacity changed. Review the seat again.');
    }
  });
}

// Called in the same transaction as creation of the purchase operation, under the sponsor lock.
export async function bindTrialPurchase(trx: Knex.Transaction, tenant: string, trialId: string, operationId: string, quote: SeatTrialQuote, allocationId?: string) {
  const pilot = await boundPilot(trx, tenant, trialId);
  const pool = await getCoManagedEntitlementState(trx, tenant);
  if (!pilot || (allocationId && pilot.allocation_id !== allocationId) || pilot.conversion_state === 'pending' || pool.available || quote.quantity !== pool.capacity + 1 || pool.allocated > pool.capacity) {
    throw new Error('The pool or pilot changed. Review the purchase again.');
  }
  await tenantDb(trx, tenant).table('co_managed_seat_trials').where({ trial_id: trialId }).update({
    conversion_state: 'pending', conversion_operation_id: operationId, quoted_quantity: quote.quantity,
    conversion_quote: quote, updated_at: trx.fn.now(),
  });
}

/** Runs before the verified capacity transaction releases the sponsor lock. */
export async function reconcileTrialPurchase(trx: Knex.Transaction, tenant: string, snapshot: HostedCoManagedSnapshot) {
  if (!snapshot.operationId || !snapshot.trialId) return;
  if (snapshot.terminalFailure) {
    await releaseTrialPurchase(trx, tenant, snapshot.operationId, 'failed', snapshot.trialId);
    return;
  }
  if (!snapshot.active) return;
  const db = tenantDb(trx, tenant);
  const pilot = await db.table('co_managed_seat_trials').where({ trial_id: snapshot.trialId, conversion_operation_id: snapshot.operationId,
    conversion_state: 'pending', quoted_quantity: snapshot.capacity }).first('trial_id');
  if (pilot && !await handoff(trx, tenant, pilot.trial_id)) {
    await db.table('co_managed_seat_trials').where({ trial_id: pilot.trial_id }).update({ conversion_state: 'failed' });
  }
}

export async function releaseTrialPurchase(db: Knex, tenant: string, operationId: string, state: 'failed' | 'cancelled', trialId?: string) {
  await db.transaction(async trx => {
    await lockCoManagedSponsorPool(trx, tenant);
    const home = tenantDb(trx, tenant);
    const updated = await home.table('co_managed_seat_trials')
      .where({ conversion_operation_id: operationId, conversion_state: 'pending', ...(trialId ? { trial_id: trialId } : {}) }).update({ conversion_state: state });
    if (updated) await home.table('co_managed_purchase_operations').where({ operation_id: operationId })
      .whereIn('state', ['preparing', 'checkout', 'payment_failed']).update({ state: 'expired', updated_at: trx.fn.now() });
  });
}
