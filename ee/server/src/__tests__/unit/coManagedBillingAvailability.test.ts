import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfferCatalog } from '../../lib/stripe/offerCatalog/catalog';
import { CO_MANAGED_SEAT_OFFER_KEY } from '../../lib/stripe/offerCatalog/types';

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

import { isCoManagedPurchaseSurfaceOpen, runWithBillingCatalogContext } from '@alga-psa/licensing';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '../../lib/actions/coManagedBillingActions';

const scope = { stripeAccount: 'acct_test', livemode: false };
const currentVersion = {
  version_id: 'version-1', stripe_account: scope.stripeAccount, livemode: false,
  offer_key: CO_MANAGED_SEAT_OFFER_KEY, billing_interval: 'month', version_number: 1,
  price_id: 'price-test', product_id: 'product-test', is_current: true,
  published_by: 'operator', created_at: new Date(), retired_at: null,
};

const reviewedQuote = { unitAmount: 1000, monthlyTotal: 1000, amountDue: 1000, currency: 'usd', offerRef: 'existing-pool-price' };

describe('quote admission from an already-open purchase screen', () => {
  let versions: (typeof currentVersion)[];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:on');
    mocks.permission.mockResolvedValue(true);
    versions = [{ ...currentVersion }];
    const db = () => ({
      where: (criteria: Partial<typeof currentVersion>) => ({
        first: async () => versions.find((row) => Object.entries(criteria).every(([key, value]) => row[key as keyof typeof row] === value)),
      }),
    });
    const catalog = createOfferCatalog({ db: async () => db as never, stripe: {} as never, scope: async () => scope, env: {} });
    mocks.service.getOfferCatalog.mockResolvedValue(catalog);
    // An existing pool can still be priced from its historical subscription even if new sales close.
    mocks.service.previewCoManagedSeats.mockResolvedValue(reviewedQuote);
  });

  afterEach(() => vi.unstubAllEnvs());

  const context = () => ({ mode: 'test' as const, stripeAccount: scope.stripeAccount, priceId: 'price-test', source: 'database' as const, sellable: versions.length > 0 && versions[0].is_current });

  it('withholds existing-pool terms after sales pause and keeps confirmation closed', async () => {
    expect(await runWithBillingCatalogContext(context(), () => isCoManagedPurchaseSurfaceOpen(mocks.user.tenant))).toBe(true);
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'quote', ...reviewedQuote });
    versions[0].is_current = false;

    expect(await runWithBillingCatalogContext(context(), () => isCoManagedPurchaseSurfaceOpen(mocks.user.tenant))).toBe(false);
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'offer_paused' });
    expect(mocks.service.previewCoManagedSeats).toHaveBeenCalledTimes(1);
    await expect(purchaseCoManagedSeatsAction({ quantity: 1, operationId: 'operation', offerRef: reviewedQuote.offerRef })).rejects.toThrow('not available');
    expect(mocks.service.purchaseCoManagedSeats).not.toHaveBeenCalled();
  });

  it('reports missing configuration before trying to price a pool', async () => {
    versions = [];
    expect(await runWithBillingCatalogContext(context(), () => isCoManagedPurchaseSurfaceOpen(mocks.user.tenant))).toBe(false);
    await expect(previewCoManagedSeatsAction(1)).resolves.toEqual({ kind: 'blocked', reason: 'misconfigured' });
    expect(mocks.service.previewCoManagedSeats).not.toHaveBeenCalled();
  });
});
