import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { OfferTermsChangedError, OfferUnavailableError } from '../../../lib/stripe/offerCatalog/types';

const MASTER = '00000000-0000-4000-8000-0000000000aa';
const mocks = vi.hoisted(() => ({ assertMaster: vi.fn(), catalog: { resolveCurrentOffer: vi.fn(), classifyPrice: vi.fn(), scope: vi.fn() }, bind: vi.fn(), reconcile: vi.fn(), runOperator: vi.fn() as any }));
vi.mock('../../../lib/auth/masterTenantAccess', () => ({
  assertMasterTenantAccess: mocks.assertMaster,
  isMasterTenantAuthError: (e: unknown) => e instanceof Error && e.message.startsWith('Access denied'),
}));
vi.mock('@ee/lib/stripe/StripeService', () => ({ getStripeService: () => ({
  getOfferCatalog: async () => mocks.catalog, bindCoManagedPortalPurchase: mocks.bind, reconcileCoManagedPortalPurchase: mocks.reconcile, runCatalogOperatorCommand: (...a: unknown[]) => mocks.runOperator(...a) }) }));

const offer = { source: 'catalog', offerKey: 'co_managed_technician_seat', interval: 'month', versionId: 'v2', versionNumber: 2, priceId: 'price_new', productId: 'prod',
  terms: { unitAmount: 1300, currency: 'eur', interval: 'month', intervalCount: 1 }, scope: { stripeAccount: 'acct_1', livemode: false } };
const post = (body: unknown, headers?: Record<string, string>) => new NextRequest('http://localhost/api', {
  method: 'POST', body: JSON.stringify(body), headers: { 'x-api-key': 'k', ...headers },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MASTER_BILLING_TENANT_ID', MASTER);
  mocks.assertMaster.mockResolvedValue({ tenantId: MASTER, userId: 'svc' });
});

describe('billing-catalog server-to-server endpoints', () => {
  it('resolve returns the offer with Stripe-derived terms and the merchant scope', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/resolve/route');
    mocks.catalog.resolveCurrentOffer.mockResolvedValue(offer);
    const res = await POST(post({ offerKey: 'co_managed_technician_seat', interval: 'month' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ offerRef: 'v2', priceId: 'price_new', terms: { unitAmount: 1300, currency: 'eur' }, merchant: { stripeAccount: 'acct_1', livemode: false } });
    expect(mocks.catalog.resolveCurrentOffer).toHaveBeenCalledWith('co_managed_technician_seat', 'month');
  });
  it.each([
    ['a tenant admin or unauthenticated caller', () => mocks.assertMaster.mockRejectedValue(new Error('Access denied: master tenant required')), 403],
  ])('rejects %s before touching the catalog', async (_name, arrange, status) => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/resolve/route');
    arrange();
    expect((await POST(post({ offerKey: 'k', interval: 'month' }))).status).toBe(status);
    expect(mocks.catalog.resolveCurrentOffer).not.toHaveBeenCalled();
  });
  it('rejects a non-operator tenant even when the gate returns it', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/resolve/route');
    mocks.assertMaster.mockResolvedValue({ tenantId: '11111111-1111-4111-8111-111111111111', userId: 'admin' });
    expect((await POST(post({ offerKey: 'k', interval: 'month' }))).status).toBe(403);
  });
  it('fails closed with an actionable reason when new sales are paused or unvalidatable', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/resolve/route');
    mocks.catalog.resolveCurrentOffer.mockRejectedValue(new OfferUnavailableError('stripe_unavailable', 'x'));
    const res = await POST(post({ offerKey: 'k', interval: 'month' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'OFFER_UNAVAILABLE', reason: 'stripe_unavailable' });
    mocks.catalog.resolveCurrentOffer.mockRejectedValue(new OfferUnavailableError('no_current_version', 'x'));
    expect((await POST(post({ offerKey: 'k', interval: 'month' }))).status).toBe(404);
  });
  it('validates input', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/resolve/route');
    expect((await POST(post({ offerKey: 'k', interval: 'fortnight' }))).status).toBe(400);
    expect((await POST(post({ interval: 'month' }))).status).toBe(400);
  });
  it('classify reports null for an unmapped price so the caller leaves capacity unchanged', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/offers/classify/route');
    mocks.catalog.scope.mockResolvedValue({ stripeAccount: 'acct_1', livemode: false });
    mocks.catalog.classifyPrice.mockResolvedValue(null);
    const res = await POST(post({ priceId: 'price_x' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });
  it('portal purchase binding answers 409 with the fresh terms when the reviewed offer changed', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/portal-purchases/route');
    mocks.bind.mockRejectedValue(new OfferTermsChangedError('v1', offer as never));
    const res = await POST(post({ entitlementId: 'e', licenseTenantId: 't', offerKey: 'k', interval: 'month', offerRef: 'v1', quantity: 2, checkoutSessionId: 'cs' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'OFFER_TERMS_CHANGED', current: { offerRef: 'v2', priceId: 'price_new' } });
  });
});

describe('billing-catalog operator endpoint', () => {
  const run = vi.fn();
  beforeEach(() => { run.mockReset().mockResolvedValue({ code: 0, lines: ['ok'] }); mocks.runOperator = run; });
  it('refuses a tenant admin before any catalog or Stripe access', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/operator/route');
    mocks.assertMaster.mockRejectedValue(new Error('Access denied: master tenant required'));
    expect((await POST(post({ command: 'publish', args: ['--price=p', '--confirm'] }))).status).toBe(403);
    mocks.assertMaster.mockResolvedValue({ tenantId: '11111111-1111-4111-8111-111111111111', userId: 'admin' });
    expect((await POST(post({ command: 'publish', args: [] }))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it('runs an operator command as the proven operator and validates the command surface', async () => {
    const { POST } = await import('../../../app/api/v1/billing-catalog/operator/route');
    const res = await POST(post({ command: 'inspect', args: ['--offer=co_managed_technician_seat'] }, { 'accept-language': 'de-DE,en;q=0.8' }));
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith('inspect', ['--offer=co_managed_technician_seat'], { tenantId: MASTER, userId: 'svc' }, 'de');
    expect((await POST(post({ command: 'drop-table', args: [] }))).status).toBe(400);
    expect((await POST(post({ command: 'inspect', args: ['not-a-flag'] }))).status).toBe(400);
  });
});
