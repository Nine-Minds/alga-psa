import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '../../lib/actions/coManagedBillingActions';
import { OfferTermsChangedError, OfferUnavailableError } from '../../lib/stripe/offerCatalog/types';
import Stripe from 'stripe';
import { StripeOwnershipError } from '../../lib/stripe/stripeCustomerOwnership';
import { CoManagedPurchaseBlockedError } from '../../lib/stripe/coManagedPurchaseErrors';

const mocks = vi.hoisted(() => ({ surface: vi.fn(), permission: vi.fn(), preview: vi.fn(), purchase: vi.fn(), key: vi.fn(),
  featureEnabled: vi.fn(),
  user: { user_id: 'actor', tenant: 'authenticated-sponsor', user_type: 'internal' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) =>
  handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/licensing', () => ({ isCoManagedPurchaseSurfaceOpen: mocks.surface, isCoManagedPurchaseFeatureEnabled: mocks.featureEnabled, registerCoManagedOfferAvailability: vi.fn() }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => ({
  getOfferCatalog: async () => ({ requireSellableOffer: vi.fn() }),
  previewCoManagedSeats: mocks.preview, purchaseCoManagedSeats: mocks.purchase, getPublishableKey: mocks.key,
}) }));

beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true); mocks.surface.mockResolvedValue(true); mocks.featureEnabled.mockResolvedValue(true);
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
    mocks.featureEnabled.mockResolvedValue(false);
    await expect(previewCoManagedSeatsAction(3)).rejects.toThrow('not available');
    await expect(purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).rejects.toThrow('not available');
    expect(mocks.surface).toHaveBeenCalledWith('authenticated-sponsor');
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.purchase).not.toHaveBeenCalled();
  });
});

describe('co-managed quote failures', () => {
  it('lets an authorized preview classify a paused offer without bypassing the release and kill-switch gate', async () => {
    mocks.preview.mockRejectedValue(new OfferUnavailableError('no_current_version', 'paused'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_paused' });
    expect(mocks.surface).not.toHaveBeenCalled();
    expect(mocks.featureEnabled).toHaveBeenCalledWith('authenticated-sponsor');
  });

  it('returns a safe billing-account error without exposing Stripe ownership details', async () => {
    mocks.preview.mockRejectedValue(new StripeOwnershipError('no_candidates', 'tenant', ['cus_private'], 'internal detail'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'customer_unverified' });
  });

  it('reports a missing current Pro subscription', async () => {
    mocks.preview.mockRejectedValue(new CoManagedPurchaseBlockedError('no_current_pro'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'no_current_pro' });
  });

  it('distinguishes paused offers, changed terms, and misconfiguration by typed errors', async () => {
    mocks.preview.mockRejectedValue(new OfferUnavailableError('no_current_version', 'private pause detail'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_paused' });
    mocks.preview.mockRejectedValue(new OfferTermsChangedError('old', { versionId: 'new', priceId: 'private', terms: { unitAmount: 1, currency: 'usd', interval: 'month', intervalCount: 1 } } as never));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_changed' });
    mocks.preview.mockRejectedValue(new OfferUnavailableError('not_configured', 'private setup detail'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'misconfigured' });
    mocks.preview.mockRejectedValue(new OfferUnavailableError('stripe_unavailable', 'temporary Stripe detail'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'temporarily_unavailable' });
    mocks.preview.mockRejectedValue(new CoManagedPurchaseBlockedError('misconfigured'));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'misconfigured' });
  });

  it('gives retry guidance when a direct Stripe request loses its connection', async () => {
    mocks.preview.mockRejectedValue(new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'private provider detail' }));
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'temporarily_unavailable' });
  });

  it('leaves unexpected failures to the server error handler', async () => {
    const error = new Error('Unexpected provider failure');
    mocks.preview.mockRejectedValue(error);
    await expect(previewCoManagedSeatsAction(1)).rejects.toBe(error);
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
  it('reports a paused offer as unavailable and keeps Stripe outages distinct in previews', async () => {
    mocks.purchase.mockRejectedValue(new OfferUnavailableError('no_current_version', 'paused'));
    expect(await purchaseCoManagedSeatsAction({ quantity: 3, operationId: 'operation' })).toEqual({ kind: 'unavailable', reason: 'no_current_version', publishableKey: null });
    mocks.preview.mockRejectedValue(new OfferUnavailableError('stripe_unavailable', 'down'));
    await expect(previewCoManagedSeatsAction(3)).resolves.toEqual({ kind: 'blocked', reason: 'temporarily_unavailable' });
  });
});
