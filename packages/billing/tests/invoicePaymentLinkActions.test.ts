import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoice: undefined as Record<string, unknown> | undefined,
  paymentService: null as any,
  origin: 'https://app.example.test' as string | null,
  allowed: true,
  tenantFilter: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) => action(
    { user_id: 'billing-user' }, { tenant: 'tenant-test' }, ...args,
  ),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => mocks.allowed) }));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ permissionError: message }),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: (_knex: unknown, tenant: string) => ({
    table: (name: string) => {
      mocks.tenantFilter(tenant, name);
      return { where: () => ({ first: async () => mocks.invoice }) };
    },
  }),
}));
vi.mock('../src/actions/paymentActions', () => ({
  getPaymentService: vi.fn(async () => mocks.paymentService),
}));
vi.mock('@alga-psa/shared/billingClients/paymentPreferences', () => ({
  isOfflinePaymentMethod: (m: string | null | undefined) => m === 'check' || m === 'bank_transfer',
}));
vi.mock('@alga-psa/tenancy/lib/tenantPortalUrl', () => ({
  getTenantPortalBaseUrl: vi.fn(async () => mocks.origin),
  buildTenantPortalUrl: vi.fn(),
}));
vi.mock('../src/lib/payments/paymentLinkToken', () => ({
  issuePaymentLinkToken: vi.fn(({ tenantId, invoiceId, lifetimeHours }: any) => ({
    token: `tok.${tenantId}.${invoiceId}.${lifetimeHours}`,
  })),
}));

import { getInvoicePaymentLinkAction } from '../src/actions/invoicePaymentLinkActions';
import { buildDurablePaymentUrl } from '../src/lib/payments/invoicePaymentUrls';

const openInvoice = {
  invoice_id: 'inv-1', status: 'sent', finalized_at: '2026-01-01T00:00:00Z',
  invoice_type: 'standard', total_amount: 10000, credit_applied: 0, payment_method: null,
};

describe('getInvoicePaymentLinkAction', () => {
  beforeEach(() => {
    mocks.invoice = { ...openInvoice };
    mocks.origin = 'https://app.example.test';
    mocks.allowed = true;
    mocks.tenantFilter.mockClear();
    mocks.paymentService = {
      hasEnabledProvider: vi.fn(async () => true),
      getPaymentSettings: vi.fn(async () => ({ paymentLinkExpirationHours: 72, paymentLinksInEmails: true })),
    };
  });

  it('returns the same /pay/<token> URL the email builds, with the tenant lifetime', async () => {
    const result: any = await getInvoicePaymentLinkAction('inv-1');
    expect(result.url).toBe(await buildDurablePaymentUrl('tenant-test', 'inv-1', 72));
    expect(result.url).toMatch(/^https:\/\/app\.example\.test\/pay\/tok\./);
  });

  it('scopes the invoice lookup to the caller tenant', async () => {
    await getInvoicePaymentLinkAction('inv-1');
    expect(mocks.tenantFilter).toHaveBeenCalledWith('tenant-test', 'invoices');
  });

  it('refuses without billing permission', async () => {
    mocks.allowed = false;
    const result: any = await getInvoicePaymentLinkAction('inv-1');
    expect(result.permissionError).toBeTruthy();
    expect(result.url).toBeUndefined();
  });

  it.each([
    ['voided', { status: 'cancelled' }, 'invoice-voided'],
    ['paid', { status: 'paid' }, 'invoice-paid'],
    ['unfinalized', { status: 'draft', finalized_at: null }, 'invoice-not-finalized'],
    ['credit note', { invoice_type: 'credit_note' }, 'credit-note'],
    ['offline payment method', { payment_method: 'check' }, 'offline-payment-method'],
  ])('returns a reason and no URL for a %s invoice', async (_label, patch, reason) => {
    mocks.invoice = { ...openInvoice, ...patch };
    const result: any = await getInvoicePaymentLinkAction('inv-1');
    expect(result.reason).toBe(reason);
    expect(result.message).toEqual(expect.any(String));
    expect(result.url).toBeUndefined();
  });

  it('returns a reason and no URL when online payments are off', async () => {
    mocks.paymentService.hasEnabledProvider = vi.fn(async () => false);
    const result: any = await getInvoicePaymentLinkAction('inv-1');
    expect(result).toMatchObject({ reason: 'online-payments-off' });
    expect(result.url).toBeUndefined();

    mocks.paymentService = null; // CE build / no payment service
    expect(await getInvoicePaymentLinkAction('inv-1')).toMatchObject({ reason: 'online-payments-off' });
  });

  it('returns a reason and no URL when there is no public origin', async () => {
    mocks.origin = null;
    const result: any = await getInvoicePaymentLinkAction('inv-1');
    expect(result).toMatchObject({ reason: 'no-public-origin' });
    expect(result.url).toBeUndefined();
  });

  it('returns not-found for an invoice outside the tenant', async () => {
    mocks.invoice = undefined;
    expect(await getInvoicePaymentLinkAction('other')).toMatchObject({ reason: 'invoice-not-found' });
  });
});
