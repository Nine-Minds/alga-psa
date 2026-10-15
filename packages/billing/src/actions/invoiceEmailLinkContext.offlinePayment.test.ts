import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Invoices issued for payment by check or bank transfer carry no online
 * "Pay now" link (plan Q1). The shared link context serves both the direct
 * send action and the scheduled email job, so gating it here gates both.
 */

const mocks = vi.hoisted(() => ({
  getOrCreatePaymentLink: vi.fn(async () => ({ url: 'https://checkout.test/session' })),
  getPaymentService: vi.fn(),
}));

vi.mock('./paymentActions', () => ({
  getPaymentService: mocks.getPaymentService,
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getPortalDomainStatusForTenant: vi.fn(async () => ({ status: 'none' })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getInvoiceEmailLinkContext } from './invoiceEmailLinkContext';

const payableInvoice = {
  invoice_id: 'inv-1',
  status: 'sent',
  finalized_at: '2026-09-01T00:00:00Z',
  invoice_type: 'standard',
  total_amount: 10_000,
  credit_applied: 0,
};

describe('getInvoiceEmailLinkContext — payment method', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = 'https://psa.example.test';
    mocks.getOrCreatePaymentLink.mockClear();
    mocks.getPaymentService.mockReset();
    mocks.getPaymentService.mockResolvedValue({
      hasEnabledProvider: vi.fn(async () => true),
      getPaymentSettings: vi.fn(async () => ({ paymentLinksInEmails: true })),
      getOrCreatePaymentLink: mocks.getOrCreatePaymentLink,
    });
  });

  it.each(['check', 'bank_transfer'])(
    'omits the payment link but keeps the portal link for %s invoices',
    async (method) => {
      const context = await getInvoiceEmailLinkContext('tenant-1', {
        ...payableInvoice,
        payment_method: method,
      });

      expect(context.paymentUrl).toBeUndefined();
      expect(context.portalUrl).toContain('/client-portal/billing');
      // No Checkout session is even created for an offline invoice.
      expect(mocks.getOrCreatePaymentLink).not.toHaveBeenCalled();
    },
  );

  it.each([['credit_card'], [null], [undefined]])(
    'keeps the payment link when the method is %s',
    async (method) => {
      const context = await getInvoiceEmailLinkContext('tenant-1', {
        ...payableInvoice,
        payment_method: method as string | null | undefined,
      });

      expect(context.paymentUrl).toBe('https://checkout.test/session');
      expect(mocks.getOrCreatePaymentLink).toHaveBeenCalledWith('inv-1');
    },
  );
});
