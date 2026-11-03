import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface CoManagedPurchaseOperation {
  operation_id: string;
  /** Absolute pool target (total purchased seats), never a delta. */
  quantity: number;
  state: 'preparing' | 'checkout' | 'completed' | 'expired' | 'payment_failed';
  provider_reference: string | null;
}

export type CoManagedPurchaseResult =
  | { kind: 'checkout'; sessionId: string; clientSecret: string }
  | { kind: 'updated'; subscriptionId: string | null }
  | { kind: 'expired' };

export class CoManagedPurchaseError extends Error {
  constructor(public readonly code: 'INVALID_PURCHASE' | 'SPONSOR_NOT_ELIGIBLE' | 'PURCHASE_IN_PROGRESS' |
    'OPERATION_CONFLICT' | 'ALLOCATED_CAPACITY_REQUIRED' | 'OFFLINE_LICENSE_REQUIRED') {
    super({
      INVALID_PURCHASE: 'Enter a valid seat quantity and purchase reference.',
      SPONSOR_NOT_ELIGIBLE: 'Only Pro PSA workspaces can purchase co-managed seats.',
      PURCHASE_IN_PROGRESS: 'Complete or resume the pending purchase before starting another.',
      OPERATION_CONFLICT: 'This purchase was started with a different seat quantity.',
      ALLOCATED_CAPACITY_REQUIRED: 'Release allocated customer seats before reducing this pool.',
      OFFLINE_LICENSE_REQUIRED: 'Update the signed license to change self-hosted co-managed capacity.',
    }[code]);
    this.name = 'CoManagedPurchaseError';
  }
}

const IN_FLIGHT = ['preparing', 'checkout', 'payment_failed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allocatedSeats(trx: Knex.Transaction, tenant: string): Promise<number> {
  const totals = await tenantDb(trx, tenant).table('co_managed_allocations').whereNot('state', 'released')
    .sum('seats as used').first();
  return Number(totals?.used ?? 0);
}

/**
 * Internal billing primitive. Callers authorize account management first; the provider adapter
 * validates live Pro eligibility and SKU ownership. A durable operation survives a lost provider
 * response without creating a second charge.
 *
 * Capacity is NEVER raised here. A purchase only asks the provider; seats appear when verified
 * provider reconciliation (a paid, live co-managed subscription) writes the entitlement. This code
 * may only lower capacity (closing the webhook-delivery gap after a reduction) or zero it for a
 * brand-new subscription that replaces a cancelled one.
 *
 * Lock order matches L1a's reservations: entitlement row, then tenant row.
 */
export async function runCoManagedPurchase(db: Knex, input: {
  sponsorTenant: string;
  operationId: string;
  quantity: number;
}, provider: (operation: CoManagedPurchaseOperation) => Promise<CoManagedPurchaseResult>): Promise<CoManagedPurchaseResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 100000 ||
      !UUID.test(input.operationId) || !UUID.test(input.sponsorTenant)) {
    throw new CoManagedPurchaseError('INVALID_PURCHASE');
  }

  // 1. Persist intent before contacting the payment provider. Tenant lock only: this transaction
  //    never waits for an entitlement lock.
  try {
    await db.transaction(async (trx) => {
      const scoped = tenantDb(trx, input.sponsorTenant);
      const tenant = await scoped.table('tenants').forUpdate().first();
      if (tenant?.product_code !== 'psa' || tenant?.plan !== 'pro') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
      const existing = await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).first();
      if (existing) {
        if (existing.quantity !== input.quantity) throw new CoManagedPurchaseError('OPERATION_CONFLICT');
        return;
      }
      if (await scoped.table('co_managed_purchase_operations').whereIn('state', IN_FLIGHT).first()) {
        throw new CoManagedPurchaseError('PURCHASE_IN_PROGRESS');
      }
      const entitlement = await scoped.table('co_managed_entitlements').first('source');
      if (entitlement?.source === 'self_host') throw new CoManagedPurchaseError('OFFLINE_LICENSE_REQUIRED');
      // An operator grant is not a billing subscription; a purchase would be unreconcilable.
      if (entitlement && entitlement.source !== 'hosted') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
      if (input.quantity < await allocatedSeats(trx, input.sponsorTenant)) {
        throw new CoManagedPurchaseError('ALLOCATED_CAPACITY_REQUIRED');
      }
      // write-admission: exempt — sponsor purchase operation lifecycle owned by licensing
      await scoped.table('co_managed_purchase_operations').insert({ tenant: input.sponsorTenant,
        operation_id: input.operationId, quantity: input.quantity, state: 'preparing' });
    });
  } catch (error) {
    // The partial unique index is the backstop for two concurrent first writers.
    if ((error as { code?: string }).code === '23505') throw new CoManagedPurchaseError('PURCHASE_IN_PROGRESS');
    throw error;
  }

  // 2. Call the provider while holding entitlement then tenant, so a reservation cannot race a reduction.
  return db.transaction(async (trx) => {
    const scoped = tenantDb(trx, input.sponsorTenant);
    const entitlement = await scoped.table('co_managed_entitlements').forUpdate().first();
    const tenant = await scoped.table('tenants').forUpdate().first();
    if (tenant?.product_code !== 'psa' || tenant?.plan !== 'pro') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
    if (entitlement?.source === 'self_host') throw new CoManagedPurchaseError('OFFLINE_LICENSE_REQUIRED');
    if (entitlement && entitlement.source !== 'hosted') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
    const operation = await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).first();
    if (operation.state === 'completed') return { kind: 'updated' as const, subscriptionId: operation.provider_reference };
    if (operation.state === 'expired') return { kind: 'expired' as const };
    if (input.quantity < await allocatedSeats(trx, input.sponsorTenant)) {
      throw new CoManagedPurchaseError('ALLOCATED_CAPACITY_REQUIRED');
    }
    const result = await provider(operation);
    if (result.kind === 'updated' && entitlement?.source === 'hosted') {
      if (result.subscriptionId && result.subscriptionId !== entitlement.source_reference) {
        // A new subscription (e.g. replacing a cancelled one) starts at capacity 0: growth stays
        // closed until the provider's paid state is verified by reconciliation.
        // write-admission: exempt — sponsor entitlement lifecycle owned by licensing
        await scoped.table('co_managed_entitlements').update({ source_reference: result.subscriptionId,
          capacity: 0, valid_until: trx.fn.now(), revision: trx.raw('revision + 1'), updated_at: trx.fn.now() });
      } else if (input.quantity < entitlement.capacity) {
        // Inline code may only lower capacity; increases wait for verified reconciliation.
        // write-admission: exempt — sponsor entitlement lifecycle owned by licensing
        await scoped.table('co_managed_entitlements').update({ capacity: input.quantity,
          revision: trx.raw('revision + 1'), updated_at: trx.fn.now() });
      }
    }
    // write-admission: exempt — sponsor purchase operation lifecycle owned by licensing
    await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).update({
      state: result.kind === 'checkout' ? 'checkout' : result.kind === 'expired' ? 'expired' : 'completed',
      provider_reference: result.kind === 'checkout' ? result.sessionId : result.kind === 'updated' ? result.subscriptionId : null,
      updated_at: trx.fn.now(),
    });
    return result;
  });
}
