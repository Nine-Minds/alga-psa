import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeCharge = vi.fn();
const retrieveAttemptPaymentIntent = vi.fn();
const recordAutoPaySuccess = vi.fn();
const expireActiveLinksForInvoice = vi.fn();
const getOrCreatePaymentLink = vi.fn();
const currentPaymentMethod = { payment_method_id: 'pm-new', external_payment_method_id: 'stripe-pm-new', external_customer_id: 'cus-1' };

vi.mock('server/src/lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn((knex: any) => ({ table: (name: string) => knex.table(name) })) }));
vi.mock('../../lib/payments/PaymentService', () => ({ PaymentService: { create: vi.fn(async () => ({ recordAutoPaySuccess, expireActiveLinksForInvoice, getOrCreatePaymentLink })) } }));
vi.mock('../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn(() => ({ chargeSavedPaymentMethod: stripeCharge, retrieveAttemptPaymentIntent })) }));
vi.mock('../../lib/temporal/invoiceAutopay', () => ({ startInvoiceAutopay: vi.fn(), signalInvoiceAutopay: vi.fn(), signalProfileAutopayChanged: vi.fn() }));
vi.mock('../../lib/payments/stripeWebhookEvents', () => ({ reconcileStripeWebhookEvents: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ getSystemEmailService: vi.fn() }));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

import { getConnection } from 'server/src/lib/db/db';
import { AutopayService } from '../../lib/payments/AutopayService';

function makeKnex(updatedAt = new Date(), invoiceStatus = 'sent') {
  const attempt = {
    attempt_id: 'attempt-1', invoice_id: 'invoice-1', billing_profile_id: 'profile-1',
    payment_method_id: 'pm-old', attempt_number: 1, status: 'processing', amount: 5000, currency: 'USD',
    provider_type: 'stripe', idempotency_key: 'autopay:tenant-1:invoice-1:attempt-1', created_at: new Date(), updated_at: updatedAt,
  };
  const rows: Record<string, any> = {
    invoice_autopay_attempts: attempt,
    invoices: { invoice_id: 'invoice-1', status: invoiceStatus, total_amount: 5000, credit_applied: 0, currency_code: 'USD', client_id: 'client-1', invoice_number: 'INV-1' },
    payment_provider_configs: { settings: { autopayEnabled: true, autopayRetryDays: [3, 5, 7] } },
    billing_profile_autopay: { payment_method_id: 'pm-new', is_enabled: true },
    payment_methods: currentPaymentMethod,
    invoice_payments: { total: 0 },
  };
  const knex: any = {
    fn: { now: () => new Date() },
    table(name: string) {
      const query: any = {
        where: () => query,
        whereIn: () => query,
        update: async () => 1,
        first: async () => rows[name],
        sum: () => query,
      };
      return query;
    },
  };
  return { knex, attempt };
}

describe('AutopayService single-attempt executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const { knex } = makeKnex();
    vi.mocked(getConnection).mockResolvedValue(knex);
    stripeCharge.mockResolvedValue({ status: 'succeeded', paymentIntentId: 'pi-1' });
    retrieveAttemptPaymentIntent.mockResolvedValue(null);
    recordAutoPaySuccess.mockResolvedValue({ success: true });
    expireActiveLinksForInvoice.mockResolvedValue(undefined);
    getOrCreatePaymentLink.mockResolvedValue({ url: 'https://pay.example/invoice-1' });
  });

  it('resumes processing attempts with the current enrolled card and the same idempotency key', async () => {
    const service = await AutopayService.create('tenant-1');
    await expect(service.executeAttempt('attempt-1')).resolves.toEqual({ status: 'succeeded' });
    await expect(service.executeAttempt('attempt-1')).resolves.toEqual({ status: 'succeeded' });

    expect(stripeCharge).toHaveBeenCalledTimes(2);
    const firstCall = stripeCharge.mock.calls[0][0];
    const secondCall = stripeCharge.mock.calls[1][0];
    expect(firstCall.paymentMethodId).toBe('stripe-pm-new');
    expect(firstCall.idempotencyKey).toBe('autopay:tenant-1:invoice-1:attempt-1');
    expect(secondCall.idempotencyKey).toBe(firstCall.idempotencyKey);
    expect(firstCall.attemptId).toBe(secondCall.attemptId);
    expect(recordAutoPaySuccess).toHaveBeenCalledTimes(2);
  });

  it('looks up an old processing attempt instead of issuing a new Stripe charge', async () => {
    const { knex } = makeKnex(new Date(Date.now() - 25 * 60 * 60 * 1000));
    vi.mocked(getConnection).mockResolvedValue(knex);
    const service = await AutopayService.create('tenant-1');
    await expect(service.executeAttempt('attempt-1')).resolves.toMatchObject({ status: 'processing' });
    expect(retrieveAttemptPaymentIntent).toHaveBeenCalledWith('attempt-1');
    expect(stripeCharge).not.toHaveBeenCalled();
  });

  it('does not create a pay link or fallback side effects for an already paid invoice', async () => {
    const { knex } = makeKnex(new Date(), 'paid');
    vi.mocked(getConnection).mockResolvedValue(knex);
    const service = await AutopayService.create('tenant-1');
    await service.finishAutopayWithFallback('invoice-1', 'attempt-1', 'payment_failed');
    expect(getOrCreatePaymentLink).not.toHaveBeenCalled();
  });
});
