'use server';
// CE stub for the EE independent-upgrade actions. The request shapes are declared
// structurally rather than imported from '@alga-psa/co-managed': a CE stub must not
// depend on the enterprise package it stands in for, and importing it here closes the
// cycle @alga-psa/co-managed -> @alga-psa/shared -> @alga-psa/ee-stubs. Matches the
// self-contained convention already used by coManagedBillingActions.ts.
type CoManagedIndependentUpgradeRequest = { operationId: string; expectedRevision: number };
type CoManagedUpgradePurchaseRequest = { operationId: string; quantity: number; interval: 'month' | 'year' };

export async function getCoManagedUpgradeScreenAction(): Promise<
  { state: 'completed'; operationId: string; progress: 'completed' } |
  { state: 'eligible'; relationshipId: string; revision: number; departed: boolean; selfHosted: boolean;
    seatsRequired: number; entitlementReady: boolean; pendingPurchase: { operationId: string; quantity: number; interval: 'month' | 'year'; paymentFailed: boolean } | null; hasOwnBilling: boolean; paidSeats: number | null; progress: 'idle' | 'running' | 'completed' | 'failed' | 'unavailable' }
> { throw new Error('Independent upgrades require the licensed tenant workflow worker.'); }

export async function startCoManagedUpgradeAction(_input: CoManagedIndependentUpgradeRequest & { relationshipId: string }): Promise<
  { completed: boolean; enqueued: boolean }
> { throw new Error('Independent upgrades require the licensed tenant workflow worker.'); }

export async function purchaseCoManagedUpgradeAction(_input: CoManagedUpgradePurchaseRequest): Promise<
  { kind: 'checkout'; clientSecret: string; publishableKey: string } | { kind: 'paid' | 'processing' | 'expired' | 'payment_failed' }
> { throw new Error('Independent checkout requires hosted billing.'); }

export async function retryCoManagedUpgradePaymentAction(_operationId: string): Promise<{ kind: 'expired' }> {
  throw new Error('Independent payment recovery requires hosted billing.');
}
export async function manageCoManagedUpgradeBillingAction(_input: { kind: 'payment_method' | 'seats'; quantity?: number }): Promise<{ url: string }> {
  throw new Error('Independent billing requires hosted billing.');
}
