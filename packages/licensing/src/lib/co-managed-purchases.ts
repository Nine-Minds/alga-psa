import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface CoManagedPurchaseOperation {
  operation_id: string;
  quantity: number;
  state: 'preparing' | 'checkout' | 'completed' | 'expired';
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

/** Internal billing primitive. Callers authorize account management first; the
 * provider adapter validates live Pro eligibility and SKU ownership. A durable
 * operation survives a lost provider response without creating a second charge. */
export async function runCoManagedPurchase(db: Knex, input: {
  sponsorTenant: string;
  operationId: string;
  quantity: number;
}, provider: (operation: CoManagedPurchaseOperation) => Promise<CoManagedPurchaseResult>): Promise<CoManagedPurchaseResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > 100000 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)) {
    throw new CoManagedPurchaseError('INVALID_PURCHASE');
  }
  // Persist intent before contacting the payment provider. This transaction
  // takes only the tenant lock and never waits for an entitlement lock.
  await db.transaction(async (trx) => {
    const scoped = tenantDb(trx, input.sponsorTenant);
    const tenant = await scoped.table('tenants').forUpdate().first();
    if (tenant?.product_code !== 'psa' || tenant?.plan !== 'pro') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
    const existing = await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).first();
    if (existing) {
      if (existing.quantity !== input.quantity) throw new CoManagedPurchaseError('OPERATION_CONFLICT');
      return;
    }
    if (await scoped.table('co_managed_purchase_operations').whereIn('state', ['preparing', 'checkout']).first()) {
      throw new CoManagedPurchaseError('PURCHASE_IN_PROGRESS');
    }
    const entitlement = await scoped.table('co_managed_entitlements').first();
    if (entitlement?.source === 'self_host') throw new CoManagedPurchaseError('OFFLINE_LICENSE_REQUIRED');
    const totals = await scoped.table('co_managed_allocations').whereNot('state', 'released').sum('seats as used').first();
    if (input.quantity < Number(totals?.used ?? 0)) throw new CoManagedPurchaseError('ALLOCATED_CAPACITY_REQUIRED');
    await scoped.table('co_managed_purchase_operations').insert({ tenant: input.sponsorTenant,
      operation_id: input.operationId, quantity: input.quantity, state: 'preparing' });
  });

  return db.transaction(async (trx) => {
    const scoped = tenantDb(trx, input.sponsorTenant);
    // Same order as reservations: entitlement, then tenant. Hold both while
    // changing purchased capacity so reservations cannot race a reduction.
    const entitlement = await scoped.table('co_managed_entitlements').forUpdate().first();
    const tenant = await scoped.table('tenants').forUpdate().first();
    if (tenant?.product_code !== 'psa' || tenant?.plan !== 'pro') throw new CoManagedPurchaseError('SPONSOR_NOT_ELIGIBLE');
    if (entitlement?.source === 'self_host') throw new CoManagedPurchaseError('OFFLINE_LICENSE_REQUIRED');
    const operation = await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).first();
    if (operation.state === 'completed') return { kind: 'updated', subscriptionId: operation.provider_reference };
    if (operation.state === 'expired') return { kind: 'expired' };
    const totals = await scoped.table('co_managed_allocations').whereNot('state', 'released').sum('seats as used').first();
    if (input.quantity < Number(totals?.used ?? 0)) throw new CoManagedPurchaseError('ALLOCATED_CAPACITY_REQUIRED');
    const result = await provider(operation);
    if (result.kind === 'updated' && entitlement && result.subscriptionId && result.subscriptionId !== entitlement.source_reference) {
      // An authorized new purchase may replace a canceled subscription. Keep
      // growth closed until the new subscription's paid capacity is verified.
      await scoped.table('co_managed_entitlements').update({ source_reference: result.subscriptionId,
        capacity: 0, valid_until: trx.fn.now(), revision: trx.raw('revision + 1'), updated_at: trx.fn.now() });
    } else if (result.kind === 'updated' && entitlement && input.quantity < entitlement.capacity) {
      // Close the webhook-delivery gap after a successful reduction. Increases
      // still require verified provider reconciliation before granting seats.
      await scoped.table('co_managed_entitlements').update({ capacity: input.quantity,
        revision: trx.raw('revision + 1'), updated_at: trx.fn.now() });
    }
    await scoped.table('co_managed_purchase_operations').where('operation_id', input.operationId).update({
      state: result.kind === 'checkout' ? 'checkout' : result.kind === 'expired' ? 'expired' : 'completed',
      provider_reference: result.kind === 'checkout' ? result.sessionId : result.kind === 'updated' ? result.subscriptionId : null,
      updated_at: trx.fn.now(),
    });
    return result;
  });
}
