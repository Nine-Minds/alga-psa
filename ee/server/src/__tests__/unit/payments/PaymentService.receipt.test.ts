/**
 * "Send payment confirmations" (alga-2026-0002724): recordPaymentFromWebhook
 * emails a receipt once, only for a newly recorded payment, only when the
 * tenant setting is on, and never lets an email failure fail the webhook.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordExternalPayment, publishWorkflowEvent, state } = vi.hoisted(() => ({
  recordExternalPayment: vi.fn(),
  publishWorkflowEvent: vi.fn(async () => undefined),
  state: { settings: null as Record<string, unknown> | string | null },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: vi.fn(() => ({
    table: (name: string) => {
      const rows: Record<string, any> = {
        payment_provider_configs: { provider_type: 'stripe', settings: state.settings },
        invoices: {
          invoice_id: 'inv-1', invoice_number: 'INV-000123', client_id: 'client-1', billing_profile_id: null,
          total_amount: 12500, credit_applied: 0, currency_code: 'USD', status: 'sent',
        },
        invoice_payments: { total: '0' },
        clients: { client_id: 'client-1', client_name: 'Acme Corp' },
      };
      const q: any = {
        where: () => q, orderBy: () => q, sum: () => q, select: () => q,
        first: async () => rows[name],
      };
      return q;
    },
  })),
}));
vi.mock('@alga-psa/billing/services/accountingSync/recordExternalPayment', () => ({ recordExternalPayment }));
vi.mock('@alga-psa/billing/services/invoiceBillingRecipientService', () => ({
  resolveInvoiceBillingRecipient: vi.fn(async () => ({ recipientEmail: 'billing@acme.test' })),
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceTerminalStatusHandlers', () => ({
  registerInvoiceTerminalStatusHandler: vi.fn(),
  listActiveInvoicePaymentLinks: vi.fn(),
  listPendingInvoicePaymentLinks: vi.fn(),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent }));
vi.mock('@alga-psa/email', () => ({ sendPaymentReceiptEmail: vi.fn() }));
vi.mock('../../../lib/payments/StripePaymentProvider', () => ({ createStripePaymentProvider: vi.fn(() => ({})) }));
vi.mock('../../../lib/payments/SavedPaymentMethodService', () => ({ SavedPaymentMethodService: class {} }));
vi.mock('../../../lib/payments/AutopayService', () => ({ AutopayService: class {} }));
vi.mock('../../../lib/temporal/invoiceAutopay', () => ({ signalInvoiceAutopay: vi.fn() }));
vi.mock('server/src/lib/utils/transactionUtils', () => ({ recordTransaction: vi.fn() }));

import { PaymentService } from '../../../lib/payments/PaymentService';

const event: any = {
  eventId: 'evt_1', eventType: 'checkout.session.completed', provider: 'stripe',
  invoiceId: 'inv-1', amount: 12500, currency: 'USD', paymentIntentId: 'pi_1', status: 'succeeded',
};

async function record(sender: any) {
  const service = await PaymentService.create('tenant-1', { receiptSender: sender });
  return (service as any).recordPaymentFromWebhook(event);
}

describe('PaymentService receipt emails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.settings = { sendPaymentConfirmations: true };
    recordExternalPayment.mockResolvedValue({ success: true, paymentId: 'pay-1', newStatus: 'paid' });
  });

  it('sends exactly one receipt when the flag is on', async () => {
    const sender = vi.fn(async () => true);
    const result = await record(sender);
    expect(result).toMatchObject({ success: true, paymentRecorded: true, paymentId: 'pay-1' });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1', email: 'billing@acme.test', clientName: 'Acme Corp',
      invoiceNumber: 'INV-000123', amountMinor: 12500, currency: 'USD',
    }));
  });

  it('sends nothing when the flag is off', async () => {
    state.settings = { sendPaymentConfirmations: false };
    const sender = vi.fn(async () => true);
    expect((await record(sender)).paymentRecorded).toBe(true);
    expect(sender).not.toHaveBeenCalled();
  });

  it('honours the flag when settings arrive as a JSON string', async () => {
    state.settings = JSON.stringify({ sendPaymentConfirmations: false });
    const sender = vi.fn(async () => true);
    await record(sender);
    expect(sender).not.toHaveBeenCalled();
  });

  it('still records the payment when the sender throws', async () => {
    const sender = vi.fn(async () => { throw new Error('smtp down'); });
    const result = await record(sender);
    expect(result).toMatchObject({ success: true, paymentRecorded: true, paymentId: 'pay-1' });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for a replay of an already-recorded event', async () => {
    recordExternalPayment.mockResolvedValue({ success: true, paymentId: 'pay-1', alreadyRecorded: true });
    const sender = vi.fn(async () => true);
    const result = await record(sender);
    expect(result).toMatchObject({ success: true, paymentRecorded: false });
    expect(sender).not.toHaveBeenCalled();
  });

  it('sends nothing when recording fails', async () => {
    recordExternalPayment.mockResolvedValue({ success: false, error: 'nope' });
    const sender = vi.fn(async () => true);
    expect((await record(sender)).success).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});
