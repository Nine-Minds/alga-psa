/**
 * The decision behind "the pool is short for this allocation": pure, so the same rule serves the first
 * submit, a reload, a second return from checkout and a webhook that lands late.
 *
 * Allocation completion depends only on capacity. A purchase is idempotent by its operation id, so every
 * branch that touches money either replays the operation it already has or waits; only `review` can begin
 * a new operation, and only when no operation exists for this intent.
 */

export interface SeatPoolCapacity { purchased: number; allocated: number; available: number }

/** The in-flight purchase the server reports (`preparing`, `checkout`, `payment_failed`). */
export interface SeatPendingPurchase {
  operationId: string;
  quantity: number;
  state: 'preparing' | 'checkout' | 'payment_failed' | (string & {});
}

export type SeatPurchasePlan =
  | { short: false }
  | { short: true; shortfall: number; /** The absolute pool target: purchased plus the shortfall. */ newTotal: number };

/**
 * `available` comes from the one capacity reading (`getCoManagedEntitlementState`); nothing here sums
 * allocations. The purchase API takes the absolute pool total, never a delta.
 */
export function planCoManagedSeatPurchase(requested: number, capacity: Pick<SeatPoolCapacity, 'purchased' | 'available'>): SeatPurchasePlan {
  if (!Number.isInteger(requested) || requested < 1) return { short: false };
  const shortfall = requested - capacity.available;
  return shortfall > 0 ? { short: true, shortfall, newTotal: capacity.purchased + shortfall } : { short: false };
}

export type SeatResumeDecision =
  /** Capacity covers the request: run reserve, activate, arrangement and invite. */
  | { kind: 'complete' }
  /** A purchase is under way or paid and reconciliation has not raised capacity yet. Nothing to charge. */
  | { kind: 'waiting'; operationId: string | null; quantity: number | null }
  /** The same operation failed to take payment: offer to retry it, never a second one. */
  | { kind: 'retry'; operationId: string; quantity: number }
  /** An operation this intent already started is no longer in flight: replay it by id to learn how it ended. */
  | { kind: 'reconcile'; operationId: string; quantity: number }
  /** No operation exists for this intent: offer the review for the new pool total. */
  | { kind: 'review'; quantity: number };

export function decideCoManagedSeatResume(input: {
  requested: number;
  capacity: Pick<SeatPoolCapacity, 'purchased' | 'available'>;
  pending: SeatPendingPurchase | null;
  /** The operation recorded with the intent, if a purchase was started for it. */
  intentPurchase: { operationId: string; quantity: number } | null;
  /** The recorded operation has been replayed and reported complete; only reconciliation is outstanding. */
  settled?: boolean;
}): SeatResumeDecision {
  const plan = planCoManagedSeatPurchase(input.requested, input.capacity);
  if (!plan.short) return { kind: 'complete' };
  const { pending, intentPurchase } = input;
  if (pending?.state === 'payment_failed') return { kind: 'retry', operationId: pending.operationId, quantity: pending.quantity };
  if (pending) return { kind: 'waiting', operationId: pending.operationId, quantity: pending.quantity };
  if (intentPurchase) {
    return input.settled
      ? { kind: 'waiting', operationId: intentPurchase.operationId, quantity: intentPurchase.quantity }
      : { kind: 'reconcile', operationId: intentPurchase.operationId, quantity: intentPurchase.quantity };
  }
  return { kind: 'review', quantity: plan.newTotal };
}
