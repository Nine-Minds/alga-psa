import { describe, expect, it } from 'vitest';
import { coManagedFulfillmentProblems, decideCoManagedFulfillment, reissueCoManagedClaims, type CoManagedFulfillmentRequest } from './co-managed-fulfillment-contract';
import type { LicenseClaims } from './license-types';

const request = (over: Partial<CoManagedFulfillmentRequest> = {}): CoManagedFulfillmentRequest => ({
  idempotencyKey: 'k2', entitlementId: 'ent', licenseTenantId: 'tenant-a', purchaseId: 'p', stripeSubscriptionId: 'sub_1',
  sequence: 2, paidPeriodEnd: '2026-12-18T00:00:00Z', coManagedSeats: 5, ...over });
const none = { lastSequence: null, lastPaidPeriodEnd: null, lastIdempotencyKey: null };
const claims: LicenseClaims = { iss: 'nineminds-license', sub: 'lic', cust: 'Acme', tier: 'pro', seats: 25, co_managed_seats: 2, iat: 1, exp: 2000000000, aud: 'tenant-a' };

describe('co-managed fulfillment contract', () => {
  it('validates absolute counts', () => {
    expect(coManagedFulfillmentProblems(request())).toEqual([]);
    expect(coManagedFulfillmentProblems(request({ coManagedSeats: -1 })).join()).toMatch(/absolute count/);
    expect(coManagedFulfillmentProblems(request({ coManagedSeats: 1.5 }))).not.toEqual([]);
    expect(coManagedFulfillmentProblems(request({ paidPeriodEnd: 'nope', sequence: 0 })).length).toBe(2);
  });
  it('applies new, duplicates the retry, and rejects stale sequence and paid period', () => {
    expect(decideCoManagedFulfillment(none, request())).toEqual({ kind: 'apply' });
    const applied = { lastSequence: 2, lastPaidPeriodEnd: '2026-12-18T00:00:00Z', lastIdempotencyKey: 'k2' };
    expect(decideCoManagedFulfillment(applied, request())).toEqual({ kind: 'duplicate' });
    expect(decideCoManagedFulfillment(applied, request({ idempotencyKey: 'k1', sequence: 1 }))).toEqual({ kind: 'stale', reason: 'older_sequence' });
    expect(decideCoManagedFulfillment(applied, request({ idempotencyKey: 'k3', sequence: 3, paidPeriodEnd: '2026-11-18T00:00:00Z' }))).toEqual({ kind: 'stale', reason: 'older_paid_period' });
    expect(decideCoManagedFulfillment(applied, request({ idempotencyKey: 'k3', sequence: 3 }))).toEqual({ kind: 'apply' });
  });
  it('re-signs with the absolute count and preserves base seats and every other claim', () => {
    expect(reissueCoManagedClaims(claims, request({ coManagedSeats: 7 }))).toEqual({ ...claims, co_managed_seats: 7 });
    const zero = reissueCoManagedClaims(claims, request({ coManagedSeats: 0 }));
    expect(zero.co_managed_seats).toBeUndefined();
    expect(zero).toMatchObject({ seats: 25, aud: 'tenant-a', exp: 2000000000, cust: 'Acme', sub: 'lic' });
  });
  it('refuses a license bound to another appliance tenant', () => {
    expect(() => reissueCoManagedClaims(claims, request({ licenseTenantId: 'tenant-b' }))).toThrow(/audience/);
  });
});
