import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  getOrCreateInvoicePaymentLinkUrl: vi.fn(async () => 'https://checkout.test/session'),
  getActiveInvoicePaymentLinkUrl: vi.fn(),
  getInvoicePaymentStatus: vi.fn(),
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  totalPaid: 0,
  invoice: {
    invoice_id: 'invoice-1',
    client_id: 'client-1',
    finalized_at: '2026-09-01T00:00:00Z',
    status: 'sent',
    invoice_type: 'standard',
    total_amount: 10_000,
    credit_applied: 0,
    payment_method: null as string | null,
  },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) =>
    action(
      { user_id: 'portal-user', contact_id: 'contact-1' },
      { tenant: 'tenant-1' },
      ...args,
    ),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
  tenantDb: () => ({
    table: (tableName: string) => {
      const query: any = {
        where: () => query,
        select: () => query,
        sum: () => query,
        first: async () => tableName === 'contacts'
          ? { client_id: 'client-1' }
          : tableName === 'invoice_payments'
            ? { total: String(mocks.totalPaid) }
            : mocks.invoice,
      };
      return query;
    },
  }),
}));

vi.mock('@alga-psa/billing/actions/paymentActions', () => ({
  getActiveInvoicePaymentLinkUrl: mocks.getActiveInvoicePaymentLinkUrl,
  getInvoicePaymentStatus: mocks.getInvoicePaymentStatus,
  getOrCreateInvoicePaymentLinkUrl: mocks.getOrCreateInvoicePaymentLinkUrl,
  expireInvoicePaymentLinksForTerminalStatus: mocks.expireInvoicePaymentLinksForTerminalStatus,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: mocks.loggerError,
    info: mocks.loggerInfo,
    warn: vi.fn(),
  },
}));

import { getClientPortalInvoicePaymentLink } from './clientPaymentActions';

describe('getClientPortalInvoicePaymentLink — offline payment methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoice.payment_method = null;
    mocks.invoice.credit_applied = 0;
    mocks.totalPaid = 0;
  });

  it.each(['check', 'bank_transfer'])(
    'rejects %s invoices before creating an online checkout session',
    async (paymentMethod) => {
      mocks.invoice.payment_method = paymentMethod;

      const result = await getClientPortalInvoicePaymentLink('invoice-1');

      expect(result).toMatchObject({
        success: false,
        error: { code: 'offline_payment_method' },
      });
      expect(mocks.getOrCreateInvoicePaymentLinkUrl).not.toHaveBeenCalled();
    },
  );

  it.each(['credit_card', null])(
    'keeps checkout available when the payment method is %s',
    async (paymentMethod) => {
      mocks.invoice.payment_method = paymentMethod;

      const result = await getClientPortalInvoicePaymentLink('invoice-1');

      expect(result).toEqual({
        success: true,
        data: { paymentUrl: 'https://checkout.test/session' },
      });
      expect(mocks.getOrCreateInvoicePaymentLinkUrl).toHaveBeenCalledWith('invoice-1');
    },
  );
});

describe('getClientPortalInvoicePaymentLink — amount due nets payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoice.payment_method = null;
    mocks.invoice.credit_applied = 0;
    mocks.totalPaid = 0;
  });

  it('reports no_amount_due when payments cover the whole total', async () => {
    mocks.totalPaid = 10_000;

    const result = await getClientPortalInvoicePaymentLink('invoice-1');

    expect(result).toMatchObject({ success: false, error: { code: 'no_amount_due' } });
    expect(mocks.getOrCreateInvoicePaymentLinkUrl).not.toHaveBeenCalled();
  });

  it('reports no_amount_due when credit plus payments cover the total', async () => {
    mocks.invoice.credit_applied = 4_000;
    mocks.totalPaid = 6_000;

    const result = await getClientPortalInvoicePaymentLink('invoice-1');

    expect(result).toMatchObject({ success: false, error: { code: 'no_amount_due' } });
  });

  it('keeps checkout available for a partial payment', async () => {
    mocks.totalPaid = 1_000;

    const result = await getClientPortalInvoicePaymentLink('invoice-1');

    expect(result).toMatchObject({ success: true });
  });
});
