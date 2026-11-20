import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBillingCatalogContext, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { loadBillingCatalogContext, withBillingCatalogContext } from '../../../lib/stripe/offerCatalog/surfaceProbe';

const mocks = vi.hoisted(() => ({ setting: vi.fn(), resolve: vi.fn(), mode: vi.fn() }));
vi.mock('../../../lib/stripe/StripeService', () => ({ getStripeService: () => ({ getOfferCatalog: async () => ({
  resolveCurrentOffer: mocks.resolve,
  deploymentLivemode: async () => mocks.mode(),
  effectiveAccountSetting: async () => {
    const setting = await mocks.setting();
    return { stripeAccount: setting?.stripe_account ?? null, priceId: setting?.price_id ?? null,
      accountSource: setting ? 'database' : 'unconfigured', priceSource: setting ? 'database setting' : 'unconfigured', historicalAccounts: [] };
  },
}) }) }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: async () => true }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode.mockResolvedValue(false);
  mocks.setting.mockResolvedValue({ stripe_account: 'acct_test', price_id: 'price_database' });
  mocks.resolve.mockResolvedValue({ priceId: 'price_database', source: 'catalog', scope: { stripeAccount: 'acct_test', livemode: false } });
});

describe('per-request billing catalog context', () => {
  it('loads the current mode row and gives the overview entry point an independent context', async () => {
    const context = await loadBillingCatalogContext();
    expect(context).toEqual({ mode: 'test', stripeAccount: 'acct_test', priceId: 'price_database', source: 'database', sellable: true });
    const overview = await withBillingCatalogContext(async () => ({
      open: await isCoManagedPurchaseSurfaceOpen('sponsor'), context: currentBillingCatalogContext(),
    }));
    expect(overview.open).toBe(true);
    expect(overview.context).toEqual(context);
  });

  it('keeps live and test settings isolated and refuses an offer with no current sellable price', async () => {
    mocks.mode.mockResolvedValue(true);
    mocks.setting.mockResolvedValue({ stripe_account: 'acct_live', price_id: 'price_live' });
    mocks.resolve.mockRejectedValue(new Error('no current version'));
    const context = await loadBillingCatalogContext();
    expect(context).toMatchObject({ mode: 'live', stripeAccount: 'acct_live', priceId: 'price_live', source: 'database', sellable: false });
    await expect(withBillingCatalogContext(() => isCoManagedPurchaseSurfaceOpen('sponsor'))).resolves.toBe(false);
  });

  it('fails closed when the configured account price and current offer mapping disagree', async () => {
    mocks.setting.mockResolvedValue({ stripe_account: 'acct_test', price_id: 'price_old' });
    const context = await loadBillingCatalogContext();
    expect(context.sellable).toBe(false);
    await expect(withBillingCatalogContext(() => isCoManagedPurchaseSurfaceOpen('sponsor'))).resolves.toBe(false);
  });
});
