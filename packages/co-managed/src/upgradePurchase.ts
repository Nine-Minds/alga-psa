import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { countCoManagedCommittedSeats } from '@alga-psa/licensing';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

export interface CoManagedUpgradePurchaseRequest { operationId: string; quantity: number; interval: 'month' | 'year' }
export interface CoManagedUpgradePurchase {
  tenant: string; operation_id: string; requested_by: string; quantity: number; billing_interval: 'month' | 'year'; price_id: string;
  state: 'preparing' | 'checkout' | 'paid' | 'expired' | 'payment_failed'; customer_id: string | null; checkout_session_id: string | null;
  subscription_id: string | null; created_at: Date; updated_at: Date;
}

/** Internal customer-admin payment boundary. Provider calls belong outside this
 * transaction; each delivery of checkout credentials rechecks current authority. */
export function withCoManagedUpgradePurchaseAdmin<T>(db: Knex, input: CoManagedSessionActor,
  work: (trx: Knex.Transaction, actor: CoManagedSessionActor) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(input);
  return withTransaction(db, async trx => {
    const own = tenantDb(trx, actor.tenant);
    const owner = await own.table('tenants').forUpdate().first('product_code');
    if (!owner || !['co_managed', 'psa'].includes(owner.product_code) || await trx('license_state').first('id')) throw new CoManagedSharedWorkError();
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true) ||
        !await own.table('co_management_relationships').whereIn('state', ['active', 'terminated']).first('relationship_id')) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work(trx, actor);
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}

export function prepareCoManagedUpgradePurchase(db: Knex, actor: CoManagedSessionActor,
  input: CoManagedUpgradePurchaseRequest, priceId: string): Promise<CoManagedUpgradePurchase> {
  if (!input || !isCoManagedUuid(input.operationId) || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000 ||
      !['month', 'year'].includes(input.interval) || typeof priceId !== 'string' || !priceId.trim()) throw new Error('Invalid independent PSA purchase');
  const request = { ...input }, price = priceId;
  return withCoManagedUpgradePurchaseAdmin(db, actor, async (trx, current) => {
    const own = tenantDb(trx, current.tenant);
    const previous = await own.table<CoManagedUpgradePurchase>('co_managed_upgrade_purchases').where('operation_id', request.operationId).first();
    if (previous) {
      if (previous.quantity !== request.quantity || previous.billing_interval !== request.interval) throw new Error('Purchase terms have changed');
      return previous;
    }
    if ((await own.table('tenants').first('product_code'))?.product_code !== 'co_managed') throw new CoManagedSharedWorkError();
    if (await own.table('co_managed_upgrade_purchases').whereIn('state', ['preparing', 'checkout', 'payment_failed']).first('operation_id')) throw new Error('Resume the pending independent PSA purchase');
    if (await own.table('stripe_subscriptions').whereNotIn('status', ['canceled', 'incomplete_expired'])
      .whereRaw("COALESCE(metadata->>'addon_key', '') = ''").first('stripe_subscription_id')) throw new Error('This workspace already has a PSA subscription');
    if (request.quantity < await countCoManagedCommittedSeats(trx, current.tenant)) throw new Error('Purchase enough seats for current technicians and invitations');
    const [operation] = await own.table<CoManagedUpgradePurchase>('co_managed_upgrade_purchases').insert({ tenant: current.tenant,
      operation_id: request.operationId, requested_by: current.userId, quantity: request.quantity, billing_interval: request.interval, price_id: price, state: 'preparing' }).returning('*');
    return operation;
  });
}
