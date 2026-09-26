import { describe, expect, it } from 'vitest';
import { classifyAutopayFailure, retryAt, shouldScheduleAutopay } from '../../../lib/payments/autopayPolicy';
import { buildAutopayPaymentIntentRequest } from '../../../lib/payments/stripeAutopayParams';

const chargeRequest = {
  amount: 4550, currency: 'USD', customerId: 'cus_1', paymentMethodId: 'pm_1', invoiceId: 'inv_1', clientId: 'client_1',
  billingProfileId: 'profile_1', attemptId: 'attempt_1', idempotencyKey: 'autopay:tenant_1:inv_1:attempt_1', description: 'Invoice INV-1',
};

describe('autopay policy and Stripe request construction', () => {
  it('builds a confirmed off-session charge with per-attempt idempotency and tenant metadata', () => {
    const { params, options } = buildAutopayPaymentIntentRequest('tenant_1', chargeRequest);
    expect(params).toMatchObject({ off_session: true, confirm: true, amount: 4550, customer: 'cus_1', payment_method: 'pm_1', metadata: {
      tenant_id: 'tenant_1', invoice_id: 'inv_1', client_id: 'client_1', billing_profile_id: 'profile_1', autopay_attempt_id: 'attempt_1',
    } });
    expect(options.idempotencyKey).toBe('autopay:tenant_1:inv_1:attempt_1');
  });

  it.each(['stolen_card', 'lost_card', 'fraudulent', 'expired_card'])('classifies %s as a hard decline', (declineCode) => {
    expect(classifyAutopayFailure(undefined, declineCode)).toMatchObject({ retryable: false, hardDecline: true });
  });

  it('stops retrying do_not_honor on the final retry and maps authentication to no retry', () => {
    expect(classifyAutopayFailure(undefined, 'do_not_honor', 4, 3).retryable).toBe(false);
    expect(classifyAutopayFailure('authentication_required').retryable).toBe(false);
  });

  it('applies the configured day offsets from the failure time', () => {
    expect(retryAt(new Date('2026-01-01T00:00:00Z'), [3, 5, 7], 2)?.toISOString()).toBe('2026-01-06T00:00:00.000Z');
    expect(retryAt(new Date(), [3], 2)).toBeNull();
  });

  it('skips attempts unless every chargeability and invoice rule passes', () => {
    const valid = { invoiceExists: true, finalized: true, creditNote: false, tenantEnabled: true, enrolled: true, chargeableMethod: true,
      providerEnabled: true, balanceCents: 10, currencySupported: true, hasOpenAttempt: false };
    expect(shouldScheduleAutopay(valid)).toBe(true);
    expect(shouldScheduleAutopay({ ...valid, creditNote: true })).toBe(false);
    expect(shouldScheduleAutopay({ ...valid, balanceCents: 0 })).toBe(false);
    expect(shouldScheduleAutopay({ ...valid, hasOpenAttempt: true })).toBe(false);
    expect(shouldScheduleAutopay({ ...valid, chargeableMethod: false })).toBe(false);
  });
});
