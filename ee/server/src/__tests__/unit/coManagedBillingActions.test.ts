import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '../../lib/actions/coManagedBillingActions';
import { OfferTermsChangedError, OfferUnavailableError } from '../../lib/stripe/offerCatalog/types';

const mocks = vi.hoisted(() => ({ surface: vi.fn(), permission: vi.fn(), preview: vi.fn(), purchase: vi.fn(), key: vi.fn(),
  user: { user_id: 'actor', tenant: 'authenticated-sponsor', user_type: 'internal' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) =>
  handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/licensing', () => ({ isCoManagedPurchaseSurfaceOpen: mocks.surface, registerCoManagedOfferAvailability: vi.fn() }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  previewCoManagedSeats: mocks.preview, purchaseCoManagedSeats: mocks.purchase, getPublishableKey: mocks.key,
}) }));

beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true); mocks.surface.mockResolvedValue(true);
  mocks.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'subscription' });
});

describe('co-managed billing authorization', () => {
  it('requires billing update permission for previews and charges', async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(previewCoManagedSeatsAction(3)).rejects.toThrow('Permission denied');
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('Permission denied');
    expect(mocks.permission).toHaveBeenCalledWith(mocks.user, 'account_management', 'update');
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('denies a requester even if a permission adapter returns an allow', async () => {
    mocks.user.user_type = 'client';
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('Permission denied');
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it('uses the authenticated sponsor, ignoring a caller-supplied tenant', async () => {
    await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation', tenant: 'other-sponsor' } as any);
    expect(mocks.purchase).toHaveBeenCalledWith('authenticated-sponsor', 3, 'operation', undefined);
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it('returns the publishable key only when opening checkout', async () => {
    mocks.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 'session', clientSecret: 'secret' });
    mocks.key.mockResolvedValue('pk_test_public');
    expect(await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).toEqual({
      kind: 'checkout', sessionId: 'session', clientSecret: 'secret', publishableKey: 'pk_test_public',
    });
  });
  it('is inert when the purchase surface is closed (kill switch, flag or price id): no provider call', async () => {
    mocks.surface.mockResolvedValue(false);
    await expect(previewCoManagedSeatsAction(3)).rejects.toThrow('not available');
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('not available');
    expect(mocks.surface).toHaveBeenCalledWith('authenticated-sponsor');
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.purchase).not.toHaveBeenCalled();
  });
});

describe('co-managed offer terms at confirmation', () => {
  const current = { versionId: 'v2', priceId: 'price_new', terms: { unitAmount: 1300, currency: 'eur', interval: 'month', intervalCount: 1 } };
  it('passes the reviewed offer reference to the service', async () => {
    await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation', offerRef: 'v1' });
    expect(mocks.purchase).toHaveBeenCalledWith('authenticated-sponsor', 3, 'operation', 'v1');
  });
  it('turns a changed price into a fresh-review outcome (nothing charged), not an error', async () => {
    mocks.purchase.mockRejectedValue(new OfferTermsChangedError('v1', current as never));
    expect(await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation', offerRef: 'v1' })).toEqual({
      kind: 'review_required', offerRef: 'v2', unitAmount: 1300, currency: 'eur', interval: 'month', publishableKey: null });
  });
  it('reports a paused offer as unavailable and hides the cause from previews', async () => {
    mocks.purchase.mockRejectedValue(new OfferUnavailableError('no_current_version', 'paused'));
    expect(await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).toEqual({ kind: 'unavailable', reason: 'no_current_version', publishableKey: null });
    mocks.preview.mockRejectedValue(new OfferUnavailableError('stripe_unavailable', 'down'));
    await expect(previewCoManagedSeatsAction(3)).rejects.toThrow('temporarily unavailable');
  });
});
