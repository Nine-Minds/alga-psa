import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./paymentActions', () => ({
  getPaymentService: vi.fn(),
  expireInvoicePaymentLinksForTerminalStatus: vi.fn(),
}));
vi.mock('@alga-psa/tenancy/lib/portalDomainStatus', () => ({ getPortalDomainStatusForTenant: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { resolvePayLink, isSafeCheckoutRedirect, type PayLinkDeps } from './payLinkResolver';
import { issuePaymentLinkToken } from '../lib/payments/paymentLinkToken';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INVOICE = '22222222-2222-4222-8222-222222222222';
const PORTAL = 'https://psa.example.test/client-portal/billing?tab=invoices&invoiceId=' + INVOICE;
const NOW = new Date('2026-10-01T00:00:00Z');
const payable = {
  invoice_id: INVOICE,
  status: 'sent',
  finalized_at: '2026-09-01T00:00:00Z',
  invoice_type: 'standard',
  total_amount: 10_000,
  credit_applied: 0,
  payment_method: null,
};

function deps(overrides: Partial<PayLinkDeps> = {}): PayLinkDeps {
  return {
    now: () => NOW,
    loadInvoice: vi.fn(async () => payable),
    getCheckoutUrl: vi.fn(async () => 'https://checkout.stripe.com/c/pay/cs_test_1'),
    buildPortalUrl: vi.fn(async () => PORTAL),
    ...overrides,
  };
}
const token = (hours = 168) => issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: hours }, NOW).token;

describe('resolvePayLink', () => {
  beforeEach(() => { process.env.NEXTAUTH_SECRET = 'unit-test-secret'; });

  it('redirects to the provider session for an eligible invoice, scoped to the token tenant', async () => {
    const d = deps();
    expect(await resolvePayLink(token(), d)).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(d.loadInvoice).toHaveBeenCalledWith(TENANT, INVOICE);
    expect(d.getCheckoutUrl).toHaveBeenCalledWith(TENANT, INVOICE);
  });

  it.each(['paid', 'cancelled', 'draft'])('falls back to the portal for a %s invoice without creating a session', async (status) => {
    const d = deps({ loadInvoice: vi.fn(async () => ({ ...payable, status })) });
    expect(await resolvePayLink(token(), d)).toEqual({ kind: 'fallback', reason: 'not_payable', portalUrl: PORTAL });
    expect(d.getCheckoutUrl).not.toHaveBeenCalled();
  });

  it('falls back for offline-payment invoices, missing invoices, and fully credited invoices', async () => {
    for (const row of [{ ...payable, payment_method: 'check' }, null, { ...payable, credit_applied: 10_000 }]) {
      const d = deps({ loadInvoice: vi.fn(async () => row) });
      expect(await resolvePayLink(token(), d)).toMatchObject({ kind: 'fallback', reason: 'not_payable' });
      expect(d.getCheckoutUrl).not.toHaveBeenCalled();
    }
  });

  it('falls back (not_payable) when the payment service yields no session (balance settled / no provider)', async () => {
    const d = deps({ getCheckoutUrl: vi.fn(async () => null) });
    expect(await resolvePayLink(token(), d)).toMatchObject({ kind: 'fallback', reason: 'not_payable', portalUrl: PORTAL });
  });

  it('falls back with the portal URL for an expired token and touches nothing', async () => {
    const d = deps({ now: () => new Date(NOW.getTime() + 169 * 3600_000) });
    expect(await resolvePayLink(token(168), d)).toEqual({ kind: 'fallback', reason: 'expired', portalUrl: null });
    expect(d.loadInvoice).not.toHaveBeenCalled();
    expect(d.getCheckoutUrl).not.toHaveBeenCalled();
  });

  it('falls back for invalid or tampered tokens and touches nothing', async () => {
    const d = deps();
    const t = token();
    for (const bad of ['garbage', t.slice(0, -3) + 'AAA', '']) {
      expect(await resolvePayLink(bad, d)).toEqual({ kind: 'fallback', reason: 'invalid', portalUrl: null });
    }
    expect(d.loadInvoice).not.toHaveBeenCalled();
  });

  it('never throws: provider failure becomes an "unavailable" fallback', async () => {
    const d = deps({ getCheckoutUrl: vi.fn(async () => { throw new Error('Simulated Stripe outage'); }) });
    expect(await resolvePayLink(token(), d)).toEqual({ kind: 'fallback', reason: 'unavailable', portalUrl: PORTAL });
  });

  it('refuses to redirect to an unsafe URL', async () => {
    for (const url of ['javascript:alert(1)', '//evil.test/x', 'https://user:pw@evil.test/', '/relative']) {
      const d = deps({ getCheckoutUrl: vi.fn(async () => url) });
      expect(await resolvePayLink(token(), d)).toMatchObject({ kind: 'fallback', reason: 'unavailable' });
    }
  });
});

describe('isSafeCheckoutRedirect', () => {
  it('accepts absolute https URLs only (http only outside production)', () => {
    expect(isSafeCheckoutRedirect('https://checkout.stripe.com/c/pay/x')).toBe(true);
    expect(isSafeCheckoutRedirect('ftp://x.test')).toBe(false);
    expect(isSafeCheckoutRedirect(undefined)).toBe(false);
    const env = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(isSafeCheckoutRedirect('http://checkout.test/x')).toBe(false);
    (process.env as Record<string, string>).NODE_ENV = env as string;
  });
});
