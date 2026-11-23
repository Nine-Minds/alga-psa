import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { neverActivated } from './co-managed-entitlements';

/**
 * How long a completed purchase request may await its paid reconciliation before it is only history.
 * Matches the provider's webhook retry horizon; past it a legitimate retry must not be stranded by
 * a record whose payment never verified.
 */
export const AWAITING_VERIFICATION_WINDOW_MS = 72 * 3_600_000;

/**
 * Where the sponsor's first co-managed purchase stands, derived only from persisted purchase and
 * entitlement state (never from a checkout return, an operation status alone or a browser callback):
 *
 * - `established`: the pool was verified active at some point. Not a first purchase.
 * - `in_flight`: an operation is preparing, in checkout or retaining a failed payment.
 * - `awaiting_verification`: the request completed but no paid reconciliation has raised capacity.
 * - `none`: nothing started (or only expired / stale history).
 */
export type CoManagedFirstPurchasePhase =
  | { phase: 'established' }
  | { phase: 'in_flight'; operationId: string; quantity: number }
  | { phase: 'awaiting_verification'; operationId: string; quantity: number }
  | { phase: 'none' };

const IN_FLIGHT = ['preparing', 'checkout', 'payment_failed'];

/** Lock-free read, scoped to the sponsor tenant it is given. */
export async function readCoManagedFirstPurchasePhase(
  db: Knex | Knex.Transaction, sponsor: string, now: Date = new Date(),
): Promise<CoManagedFirstPurchasePhase> {
  const scoped = tenantDb(db, sponsor);
  const entitlement = await scoped.table('co_managed_entitlements').first();
  if (entitlement && !neverActivated(entitlement)) return { phase: 'established' };
  const pending = await scoped.table('co_managed_purchase_operations').whereIn('state', IN_FLIGHT)
    .first('operation_id', 'quantity');
  if (pending) return { phase: 'in_flight', operationId: pending.operation_id, quantity: Number(pending.quantity) };
  const completed = await scoped.table('co_managed_purchase_operations').where('state', 'completed')
    .where('quantity', '>', 0).whereNotNull('provider_reference').orderBy('updated_at', 'desc')
    .first('operation_id', 'quantity', 'updated_at');
  if (completed && now.getTime() - new Date(completed.updated_at).getTime() < AWAITING_VERIFICATION_WINDOW_MS) {
    return { phase: 'awaiting_verification', operationId: completed.operation_id, quantity: Number(completed.quantity) };
  }
  return { phase: 'none' };
}
