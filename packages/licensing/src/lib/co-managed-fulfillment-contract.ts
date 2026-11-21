/**
 * Contract for delivering verified co-managed seat capacity to a signed appliance license.
 *
 * The PLATFORM (Nine Minds billing) produces a fulfillment only from verified Stripe state. The
 * ISSUER (the licensing service that holds the signing key) must: authenticate the caller,
 * deduplicate by `idempotencyKey`, reject stale requests, then re-sign the entitlement's license
 * with the absolute `co_managed_seats` while preserving every other claim. These functions are the
 * single definition of those three rules, pure and secret-free so the producer's tests and any
 * issuer implementation share one reading. Appliances learn the result only through the existing
 * check-in / refresh / verify path (`license-check-in.ts`, `verify-license.ts`); nothing here
 * adds an appliance-side transport.
 */
import type { LicenseClaims } from './license-types';

export interface CoManagedFulfillmentRequest {
  /** Stable per (purchase, paid period, seats): retries carry the same key. */
  idempotencyKey: string;
  /** The licensing service's entitlement the checkout was bound to before payment. */
  entitlementId: string;
  /** The appliance tenant (license `aud`) the entitlement belongs to. */
  licenseTenantId: string;
  purchaseId: string;
  stripeSubscriptionId: string;
  /** Strictly increasing per entitlement, assigned by the platform. */
  sequence: number;
  /** End of the verified paid period (ISO-8601). Older periods are stale. */
  paidPeriodEnd: string;
  /** Absolute verified count, never a delta. 0 means none (cancellation or reduction to zero). */
  coManagedSeats: number;
}

/** What the issuer last applied for an entitlement. Null fields mean nothing applied yet. */
export interface CoManagedFulfillmentState {
  lastSequence: number | null;
  lastPaidPeriodEnd: string | null;
  lastIdempotencyKey: string | null;
}

export type CoManagedFulfillmentDecision =
  | { kind: 'apply' }
  | { kind: 'duplicate' }
  | { kind: 'stale'; reason: 'older_sequence' | 'older_paid_period' };

export const MAX_CO_MANAGED_FULFILLMENT_SEATS = 100000;

/** Problems that make a request unusable; empty when valid. Issuers answer 400 with these. */
export function coManagedFulfillmentProblems(request: Partial<CoManagedFulfillmentRequest>): string[] {
  const problems: string[] = [];
  for (const field of ['idempotencyKey', 'entitlementId', 'licenseTenantId', 'purchaseId', 'stripeSubscriptionId'] as const) {
    if (typeof request[field] !== 'string' || !request[field]) problems.push(`${field} is required`);
  }
  if (!Number.isSafeInteger(request.sequence) || (request.sequence ?? 0) < 1) problems.push('sequence must be a positive integer');
  if (!Number.isSafeInteger(request.coManagedSeats) || (request.coManagedSeats ?? -1) < 0 ||
      (request.coManagedSeats ?? 0) > MAX_CO_MANAGED_FULFILLMENT_SEATS) problems.push('coManagedSeats must be an absolute count between 0 and 100000');
  if (!request.paidPeriodEnd || !Number.isFinite(Date.parse(request.paidPeriodEnd))) problems.push('paidPeriodEnd must be an ISO date');
  return problems;
}

/** Duplicate, stale, or apply. A retry of the last applied key is a duplicate (safe to answer OK). */
export function decideCoManagedFulfillment(state: CoManagedFulfillmentState, request: CoManagedFulfillmentRequest): CoManagedFulfillmentDecision {
  if (state.lastIdempotencyKey === request.idempotencyKey) return { kind: 'duplicate' };
  if (state.lastSequence !== null && request.sequence <= state.lastSequence) return { kind: 'stale', reason: 'older_sequence' };
  if (state.lastPaidPeriodEnd !== null && Date.parse(request.paidPeriodEnd) < Date.parse(state.lastPaidPeriodEnd)) {
    return { kind: 'stale', reason: 'older_paid_period' };
  }
  return { kind: 'apply' };
}

/**
 * Claims for the re-signed license: everything preserved (base `seats`, `aud`, `cust`, `tier`, `sub`,
 * `exp`) and only `co_managed_seats` replaced. Zero is encoded as absence ("absent means zero").
 * Expiry is deliberately untouched: the existing expiry and lapse rules govern renewal and
 * cancellation, so a lapsed license confers nothing regardless of this claim.
 */
export function reissueCoManagedClaims(current: LicenseClaims, request: Pick<CoManagedFulfillmentRequest, 'coManagedSeats' | 'licenseTenantId'>): LicenseClaims {
  if (current.aud !== request.licenseTenantId) throw new Error('License audience does not match the fulfillment tenant');
  const { co_managed_seats: _previous, ...rest } = current;
  return request.coManagedSeats > 0 ? { ...rest, co_managed_seats: request.coManagedSeats } : rest;
}
