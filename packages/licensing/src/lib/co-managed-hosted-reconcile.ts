import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { materializeState, neverActivated, type CoManagedEntitlementState } from './co-managed-entitlements';

/** The Stripe adapter must validate customer, product, price, payment state and the sponsoring
 * PSA Pro subscription before returning this snapshot. */
export interface HostedCoManagedSnapshot {
  capacity: number;
  validUntil: Date;
  active: boolean;
  lapseSince?: Date;
  /** `metadata.operation_id` of the subscription: binds a checkout-created subscription to its operation. */
  operationId?: string;
}

async function databaseNow(trx: Knex.Transaction): Promise<Date> {
  const result = await trx.raw('SELECT clock_timestamp() AS now');
  return new Date(result.rows[0].now);
}

/**
 * The only path that RAISES hosted co-managed capacity. Loads CURRENT provider state while holding
 * the sponsor's entitlement row lock (the same lock L1a's reservations take), so delayed or
 * reordered webhook deliveries cannot overwrite a newer observation. A co-managed subscription
 * never touches the MSP's own seats. Idempotent: replaying the same observation yields the same row.
 */
export async function reconcileHostedCoManagedEntitlement(
  db: Knex, sponsor: string, subscriptionId: string,
  loadCurrent: () => Promise<HostedCoManagedSnapshot>,
): Promise<CoManagedEntitlementState> {
  if (!subscriptionId) throw new Error('Co-managed subscription identity is required');
  return db.transaction(async (trx) => {
    const scoped = tenantDb(trx, sponsor);
    const initialNow = await databaseNow(trx);
    // write-admission: exempt — sponsor entitlement lifecycle owned by licensing
    await scoped.table('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted',
      source_reference: subscriptionId, capacity: 0, verified_at: initialNow, valid_until: initialNow,
    }).onConflict('tenant').ignore();
    const row = await scoped.table('co_managed_entitlements').forUpdate().first();
    if (row.source !== 'hosted' || row.source_reference !== subscriptionId) {
      throw new Error('Co-managed entitlement belongs to a different subscription');
    }
    const snapshot = await loadCurrent();
    if (!Number.isSafeInteger(snapshot.capacity) || snapshot.capacity < 0 || snapshot.capacity > 2147483647 ||
        !Number.isFinite(snapshot.validUntil.getTime()) ||
        (snapshot.lapseSince && !Number.isFinite(snapshot.lapseSince.getTime()))) {
      throw new Error('Invalid co-managed entitlement snapshot');
    }
    const now = await databaseNow(trx);
    const update = {
      capacity: snapshot.capacity,
      valid_until: snapshot.active ? snapshot.validUntil : new Date(Math.min(now.getTime(), snapshot.validUntil.getTime())),
      verified_at: now, updated_at: now, revision: trx.raw('revision + 1'),
    };
    // write-admission: exempt — sponsor entitlement lifecycle owned by licensing
    await scoped.table('co_managed_entitlements').update(update);
    // Preserve an existing lapse until current capacity is sufficient; do not reset its clock
    // just because another delinquency webhook arrived.
    const earlierLapse = new Date(Math.min(
      snapshot.lapseSince?.getTime() ?? now.getTime(),
      new Date(row.valid_until).getTime() <= now.getTime() ? new Date(row.valid_until).getTime() : now.getTime(),
    ));
    // Judged on the row BEFORE this observation: an unpaid brand-new subscription never opened a
    // pool, so it must not start a grace clock; a pool that WAS active and lapses still does.
    const neverActive = !snapshot.active && neverActivated(row);
    const state = await materializeState(trx, sponsor, { ...row, ...update }, now, earlierLapse, neverActive);
    if (snapshot.active) {
      // A verified, paid reconciliation closes ONLY the in-flight purchase it proves: same
      // subscription (provider_reference) or, for a checkout-created subscription, the operation id
      // in its metadata, AND the purchased pool target equals the reconciled capacity. An unrelated
      // in-flight operation (e.g. one opened while a base-Pro renewal event reconciles) stays open.
      // write-admission: exempt — purchase bookkeeping owned by licensing
      await scoped.table('co_managed_purchase_operations')
        .whereIn('state', ['preparing', 'checkout', 'payment_failed'])
        .where('quantity', snapshot.capacity)
        .where((match) => {
          match.where('provider_reference', subscriptionId);
          if (snapshot.operationId) match.orWhere('operation_id', snapshot.operationId);
        })
        .update({ state: 'completed', provider_reference: subscriptionId, updated_at: now });
    }
    return state;
  });
}

/** Retain a failed payment on the in-flight operation (recoverable and auditable) without
 * altering capacity. A later paid reconciliation completes it. */
export async function recordCoManagedPaymentFailure(db: Knex, sponsor: string): Promise<void> {
  await db.transaction(async (trx) => {
    // write-admission: exempt — purchase bookkeeping owned by licensing
    await tenantDb(trx, sponsor).table('co_managed_purchase_operations')
      .whereIn('state', ['preparing', 'checkout'])
      .update({ state: 'payment_failed', updated_at: trx.fn.now() });
  });
}
