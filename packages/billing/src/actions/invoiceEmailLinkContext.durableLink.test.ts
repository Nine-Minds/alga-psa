import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPaymentService: vi.fn(),
  getPortalDomainStatusForTenant: vi.fn(),
  getOrCreatePaymentLink: vi.fn(),
}));

vi.mock('./paymentActions', () => ({
  getPaymentService: mocks.getPaymentService,
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
}));
vi.mock('@alga-psa/tenancy/lib/portalDomainStatus', () => ({
  getPortalDomainStatusForTenant: mocks.getPortalDomainStatusForTenant,
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getInvoiceEmailLinkContext } from './invoiceEmailLinkContext';
import { verifyPaymentLinkToken } from '../lib/payments/paymentLinkToken';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '22222222-2222-4222-8222-222222222222';
const invoice = {
  invoice_id: INVOICE_ID,
  status: 'sent',
  finalized_at: '2026-09-01T00:00:00Z',
  invoice_type: 'standard',
  total_amount: 10_000,
  credit_applied: 0,
};

function service(overrides: Record<string, unknown> = {}) {
  return {
    hasEnabledProvider: vi.fn(async () => true),
    getPaymentSettings: vi.fn(async () => ({ paymentLinksInEmails: true, paymentLinkExpirationHours: 720 })),
    getOrCreatePaymentLink: mocks.getOrCreatePaymentLink,
    ...overrides,
  };
}

describe('getInvoiceEmailLinkContext — durable /pay link', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'unit-test-secret';
    process.env.NEXTAUTH_URL = 'https://psa.example.test';
    delete process.env.NEXT_PUBLIC_BASE_URL;
    mocks.getOrCreatePaymentLink.mockReset();
    mocks.getPortalDomainStatusForTenant.mockReset().mockResolvedValue({ status: 'none' });
    mocks.getPaymentService.mockReset().mockResolvedValue(service());
  });

  it('emails a /pay token valid for the configured lifetime and creates no Checkout session', async () => {
    const before = Date.now();
    const context = await getInvoiceEmailLinkContext(TENANT_ID, invoice);

    const url = new URL(context.paymentUrl!);
    expect(url.origin).toBe('https://psa.example.test');
    const token = url.pathname.replace('/pay/', '');
    const verified = verifyPaymentLinkToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.tenantId).toBe(TENANT_ID);
      expect(verified.invoiceId).toBe(INVOICE_ID);
      expect(verified.exp - before).toBeGreaterThanOrEqual(720 * 3600_000 - 1000);
      expect(verified.exp - before).toBeLessThan(720 * 3600_000 + 5000);
    }
    expect(mocks.getOrCreatePaymentLink).not.toHaveBeenCalled();
    expect(context.portalUrl).toContain('/client-portal/billing');
  });

  it('uses the tenant vanity domain first, like the portal URL', async () => {
    mocks.getPortalDomainStatusForTenant.mockResolvedValue({ status: 'active', domain: 'pay.acme.test' });
    const context = await getInvoiceEmailLinkContext(TENANT_ID, invoice);
    expect(new URL(context.paymentUrl!).origin).toBe('https://pay.acme.test');
    expect(new URL(context.portalUrl!).origin).toBe('https://pay.acme.test');
  });

  it.each([
    ['no provider', { hasEnabledProvider: vi.fn(async () => false) }],
    ['paymentLinksInEmails off', { getPaymentSettings: vi.fn(async () => ({ paymentLinksInEmails: false, paymentLinkExpirationHours: 168 })) }],
  ])('is portal-only with %s', async (_label, overrides) => {
    mocks.getPaymentService.mockResolvedValue(service(overrides));
    const context = await getInvoiceEmailLinkContext(TENANT_ID, invoice);
    expect(context.paymentUrl).toBeUndefined();
    expect(context.portalUrl).toBeDefined();
  });

  it('is portal-only when no payment service exists (CE)', async () => {
    mocks.getPaymentService.mockResolvedValue(null);
    const context = await getInvoiceEmailLinkContext(TENANT_ID, invoice);
    expect(context.paymentUrl).toBeUndefined();
    expect(context.portalUrl).toBeDefined();
  });

  it('degrades to portal-only and retains the cause when the token cannot be issued', async () => {
    delete process.env.NEXTAUTH_SECRET;
    const context = await getInvoiceEmailLinkContext(TENANT_ID, invoice);
    expect(context.paymentUrl).toBeUndefined();
    expect(context.portalUrl).toBeDefined();
    expect(context.paymentError?.message).toContain('NEXTAUTH_SECRET');
  });
});
