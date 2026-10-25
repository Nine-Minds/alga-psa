import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeCharge = vi.fn();
const retrieveAttemptPaymentIntent = vi.fn();
const recordAutoPaySuccess = vi.fn();
const expireActiveLinksForInvoice = vi.fn();
const getOrCreatePaymentLink = vi.fn();
const getPaymentSettings = vi.fn();
const sendEmail = vi.fn();
const resolveRecipient = vi.fn();
const buildDurablePaymentUrl = vi.fn();
const buildPortalInvoiceUrl = vi.fn();
const currentPaymentMethod = { payment_method_id: 'pm-new', external_payment_method_id: 'stripe-pm-new', external_customer_id: 'cus-1' };

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(),
  tenantDb: vi.fn((knex: any) => ({ table: (name: string) => knex.table(name) })),
}));
vi.mock('../../../lib/payments/PaymentService', () => ({ PaymentService: { create: vi.fn(async () => ({ recordAutoPaySuccess, expireActiveLinksForInvoice, getOrCreatePaymentLink, getPaymentSettings })) } }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn(() => ({ chargeSavedPaymentMethod: stripeCharge, retrieveAttemptPaymentIntent })) }));
vi.mock('../../../lib/temporal/invoiceAutopay', () => ({ startInvoiceAutopay: vi.fn(), signalInvoiceAutopay: vi.fn(), signalProfileAutopayChanged: vi.fn() }));
vi.mock('../../../lib/payments/stripeWebhookEvents', () => ({ reconcileStripeWebhookEvents: vi.fn() }));
vi.mock('@alga-psa/email', () => ({ getSystemEmailService: vi.fn(async () => ({ sendEmail })) }));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({ resolveInvoiceBillingRecipient: (...a: unknown[]) => resolveRecipient(...a) }));
vi.mock('@alga-psa/billing/lib/payments/invoicePaymentUrls', () => ({ buildDurablePaymentUrl: (...a: unknown[]) => buildDurablePaymentUrl(...a), buildPortalInvoiceUrl: (...a: unknown[]) => buildPortalInvoiceUrl(...a) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(), publishEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

import { getConnection } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { AutopayService } from '../../../lib/payments/AutopayService';

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
  const whereClauses: Record<string, any>[] = [];
  const updates: Array<{ table: string; where: Record<string, any>[]; values: Record<string, any> }> = [];
  const knex: any = {
    fn: { now: () => new Date() },
    table(name: string) {
      const scopedWhere: Record<string, any>[] = [];
      const query: any = {
        where: (clause: Record<string, any>) => { whereClauses.push(clause); scopedWhere.push(clause); return query; },
        whereIn: () => query,
        update: async (values: Record<string, any>) => { updates.push({ table: name, where: scopedWhere, values }); return 1; },
        first: async () => rows[name],
        sum: () => query,
      };
      return query;
    },
  };
  return { knex, attempt, whereClauses, updates };
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
    getOrCreatePaymentLink.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_live_dying' });
    getPaymentSettings.mockResolvedValue({ paymentLinkExpirationHours: 720 });
    resolveRecipient.mockResolvedValue({ recipientEmail: 'billing@example.test' });
    sendEmail.mockResolvedValue({ success: true });
    buildDurablePaymentUrl.mockResolvedValue('https://app.example.test/pay/TOKEN');
    buildPortalInvoiceUrl.mockResolvedValue('https://app.example.test/client-portal/billing?tab=invoices&invoiceId=invoice-1');
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

  it('emails the durable /pay/<token> link with the configured lifetime and never pre-creates a Checkout session', async () => {
    const service = await AutopayService.create('tenant-1');
    await service.finishAutopayWithFallback('invoice-1', 'attempt-1', 'payment_failed');
    expect(getOrCreatePaymentLink).not.toHaveBeenCalled();
    expect(buildDurablePaymentUrl).toHaveBeenCalledWith('tenant-1', 'invoice-1', 720);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = sendEmail.mock.calls[0][0];
    expect(email.html).toContain('/pay/TOKEN');
    expect(email.text).toContain('https://app.example.test/pay/TOKEN');
    expect(email.html + email.text).not.toContain('stripe.com');
  });

  it('uses the shared max lifetime when no payment settings exist', async () => {
    getPaymentSettings.mockResolvedValue(undefined);
    const service = await AutopayService.create('tenant-1');
    await service.finishAutopayWithFallback('invoice-1', 'attempt-1', 'payment_failed');
    expect(buildDurablePaymentUrl).toHaveBeenCalledWith('tenant-1', 'invoice-1', 720);
  });

  it('falls back to the portal URL, never a Stripe URL, when there is no public base for the durable link', async () => {
    buildDurablePaymentUrl.mockResolvedValue(null);
    const service = await AutopayService.create('tenant-1');
    await service.finishAutopayWithFallback('invoice-1', 'attempt-1', 'payment_failed');
    const email = sendEmail.mock.calls[0][0];
    expect(email.text).toContain('/client-portal/billing');
    expect(email.html).toContain('invoiceId=invoice-1');
    expect(email.html).toContain('&amp;');
    expect(email.html + email.text).not.toContain('stripe.com');
    expect(getOrCreatePaymentLink).not.toHaveBeenCalled();
  });

  it('sends no email when neither a durable nor a portal URL can be built, but still publishes the failure event', async () => {
    buildDurablePaymentUrl.mockResolvedValue(null);
    buildPortalInvoiceUrl.mockResolvedValue(null);
    const service = await AutopayService.create('tenant-1');
    await service.finishAutopayWithFallback('invoice-1', 'attempt-1', 'payment_failed');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(getOrCreatePaymentLink).not.toHaveBeenCalled();
    const { publishWorkflowEvent } = await import('@alga-psa/event-bus/publishers');
    expect(publishWorkflowEvent).toHaveBeenCalled();
  });

  it('does not cancel a processing row through the invoice-settled cancellation path', async () => {
    const { knex, attempt, whereClauses } = makeKnex();
    vi.mocked(getConnection).mockResolvedValue(knex);
    const service = await AutopayService.create('tenant-1');
    await service.cancelAttemptById('attempt-1');
    expect(attempt.status).toBe('processing');
    expect(whereClauses).toContainEqual({ attempt_id: 'attempt-1' });
    expect(whereClauses).toContainEqual({ status: 'scheduled' });
    expect(whereClauses).not.toContainEqual({ attempt_id: 'attempt-1', status: 'processing' });
  });

  it('parks the card as requires_update and still emits PAYMENT_FAILED on authentication_required (not a hard decline)', async () => {
    const { knex, updates } = makeKnex();
    vi.mocked(getConnection).mockResolvedValue(knex);
    stripeCharge.mockResolvedValue({ status: 'failed', paymentIntentId: 'pi-sca', failureCode: 'authentication_required', message: 'Authentication required' });
    const service = await AutopayService.create('tenant-1');

    const outcome = await service.executeAttempt('attempt-1');

    expect(outcome).toMatchObject({ status: 'failed', hard: false });
    const parked = updates.find((u) => u.table === 'payment_methods');
    expect(parked?.values).toMatchObject({ status: 'requires_update' });
    expect(parked?.where).toContainEqual({ payment_method_id: 'pm-new' });
    expect(publishWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PAYMENT_FAILED', idempotencyKey: 'autopay_failed:attempt-1' }));
  });

  it('does not park the card for an ordinary soft decline', async () => {
    const { knex, updates } = makeKnex();
    vi.mocked(getConnection).mockResolvedValue(knex);
    stripeCharge.mockResolvedValue({ status: 'failed', paymentIntentId: 'pi-soft', failureCode: 'card_declined', declineCode: 'insufficient_funds' });
    const service = await AutopayService.create('tenant-1');
    await service.executeAttempt('attempt-1');
    expect(updates.find((u) => u.table === 'payment_methods')).toBeUndefined();
    expect(publishWorkflowEvent).toHaveBeenCalled();
  });
});
