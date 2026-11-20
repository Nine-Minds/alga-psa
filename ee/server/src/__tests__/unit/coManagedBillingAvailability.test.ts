import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfferCatalog } from '../../lib/stripe/offerCatalog/catalog';
import { CO_MANAGED_SEAT_OFFER_KEY, OfferUnavailableError } from '../../lib/stripe/offerCatalog/types';

const mocks = vi.hoisted(() => ({
  feature: vi.fn(),
  permission: vi.fn(),
  service: { getOfferCatalog: vi.fn(), previewCoManagedSeats: vi.fn(), purchaseCoManagedSeats: vi.fn(), getPublishableKey: vi.fn() },
  user: { user_id: 'actor', tenant: 'authenticated-sponsor', user_type: 'internal' },
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) =>
  handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: mocks.feature }));
vi.mock('../../lib/stripe/StripeService', () => ({ getStripeService: () => mocks.service }));

import { isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { previewCoManagedSeatsAction } from '../../lib/actions/coManagedBillingActions';

const scope = { stripeAccount: 'acct_test', livemode: false };
const currentVersion = {
  version_id: 'version-1', stripe_account: scope.stripeAccount, livemode: false,
  offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month', version_number: 1,
  price_id: 'price-test', product_id: 'product-test', is_current: true,
  published_by: 'operator', created_at: new Date(), retired_at: null,
};

function catalogWithCurrentVersion(isCurrent: () => boolean) {
  let criteria: Record<string, unknown> = {};
  const query = {
    where(next: Record<string, unknown>) { criteria = next; return this; },
    async first() { return criteria.is_current ? (isCurrent() ? currentVersion : undefined) : currentVersion; },
  };
  const db = (() => query) as never;
  return createOfferCatalog({
    db,
    stripe: { prices: {} } as never,
    scope: async () => scope,
    env: {},
  });
}

describe('preview from an already-open purchase screen after the offer is paused', () => {
  let current = true;
  let catalog: ReturnType<typeof catalogWithCurrentVersion>;

  beforeEach(() => {
    vi.resetAllMocks();
    current = true;
    mocks.user.user_type = 'internal';
    mocks.permission.mockResolvedValue(true);
    mocks.feature.mockResolvedValue(true);
    catalog = catalogWithCurrentVersion(() => current);
    mocks.service.getOfferCatalog.mockResolvedValue(catalog);
    mocks.service.previewCoManagedSeats.mockImplementation(async () => {
      const offer = await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
      return { unitAmount: offer.terms.unitAmount, monthlyTotal: 1000, amountDue: 1000, currency: 'usd', offerRef: offer.versionId! };
    });
    // The real licensing surface probe registered by the server action calls this actual catalog method.
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
  });

  afterEach(() => { delete process.env.FORCE_CAPABILITIES; });

  it('returns offer_paused after the catalog availability decision changes to false', async () => {
    expect(await isCoManagedPurchaseSurfaceOpen('authenticated-sponsor')).toBe(true);
    expect(await catalog.isOfferSellable(CO_MANAGED_SEAT_OFFER_KEY, 'month')).toBe(true);

    current = false;
    expect(await catalog.isOfferSellable(CO_MANAGED_SEAT_OFFER_KEY, 'month')).toBe(false);
    expect(await isCoManagedPurchaseSurfaceOpen('authenticated-sponsor')).toBe(false);

    mocks.service.previewCoManagedSeats.mockImplementationOnce(async () => {
      await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
      throw new OfferUnavailableError('no_current_version', 'private catalog detail');
    });
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_paused' });
    expect(mocks.service.previewCoManagedSeats).toHaveBeenCalledWith('authenticated-sponsor', 1);
    expect(mocks.permission).toHaveBeenCalledWith(mocks.user, 'account_management', 'update');
  });
});
