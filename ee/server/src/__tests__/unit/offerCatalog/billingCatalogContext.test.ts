import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentBillingCatalogContext, isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { loadBillingCatalogContext, resetLoggedContextLoadFailures, withBillingCatalogContext } from '../../../lib/stripe/offerCatalog/surfaceProbe';

const mocks = vi.hoisted(() => ({ setting: vi.fn(), resolve: vi.fn(), mode: vi.fn(), logError: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
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
  resetLoggedContextLoadFailures();
  mocks.mode.mockResolvedValue(false);
  mocks.setting.mockResolvedValue({ stripe_account: 'acct_test', price_id: 'price_database' });
  mocks.resolve.mockResolvedValue({ priceId: 'price_database', source: 'catalog', scope: { stripeAccount: 'acct_test', livemode: false } });
});

describe('per-request billing catalog context', () => {
  it('loads the current mode row and gives the overview entry point an independent context', async () => {
    const context = await loadBillingCatalogContext();
    expect(context).toEqual({ mode: 'test', stripeAccount: 'acct_test', priceId: 'price_database', source: 'database', sellable: true });
    const overview = await withBillingCatalogContext(async () => ({
      open: await isCoManagedPurchaseSurfaceOpen('sponsor'), context: await currentBillingCatalogContext(),
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

  it('answers an unwrapped gate check from the registered loader, loading fresh each time', async () => {
    await expect(isCoManagedPurchaseSurfaceOpen('sponsor')).resolves.toBe(true);
    mocks.setting.mockResolvedValue(null);
    await expect(isCoManagedPurchaseSurfaceOpen('sponsor')).resolves.toBe(false);
    expect(mocks.setting).toHaveBeenCalledTimes(2);
  });

  it('withBillingCatalogContext loads once for all the checks in its request and again for the next', async () => {
    const checks = () => withBillingCatalogContext(async () =>
      [await isCoManagedPurchaseSurfaceOpen('sponsor'), await isCoManagedPurchaseSurfaceOpen('sponsor'), (await currentBillingCatalogContext())?.sellable]);
    await expect(checks()).resolves.toEqual([true, true, true]);
    expect(mocks.setting).toHaveBeenCalledTimes(1);
    mocks.setting.mockResolvedValue(null);
    await expect(checks()).resolves.toEqual([false, false, false]);
    expect(mocks.setting).toHaveBeenCalledTimes(2);
  });

  it('stays closed with the legacy env price set once the EE loader is registered', async () => {
    process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_env';
    try {
      mocks.setting.mockResolvedValue(null);
      await expect(isCoManagedPurchaseSurfaceOpen('sponsor')).resolves.toBe(false);
    } finally { delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; }
  });
});

describe('context load failures are observable', () => {
  class CodedError extends Error { constructor(readonly code: string, message: string) { super(message); } }

  it('logs one tenant-free line per error code and still returns an unsellable context', async () => {
    mocks.setting.mockRejectedValue(new CodedError('ECONNREFUSED', 'connect failed for tenant-123 acct_secret'));
    const first = await loadBillingCatalogContext();
    expect(first).toMatchObject({ stripeAccount: null, priceId: null, source: 'unconfigured', sellable: false });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const message = String(mocks.logError.mock.calls[0][0]);
    expect(message).toContain('ECONNREFUSED');
    expect(message).not.toMatch(/tenant-123|acct_secret/);
    expect(await loadBillingCatalogContext()).toEqual(first);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    mocks.setting.mockRejectedValue(new CodedError('57P01', 'terminating'));
    await loadBillingCatalogContext();
    expect(mocks.logError).toHaveBeenCalledTimes(2);
  });

  it('falls back to the error name when there is no code', async () => {
    mocks.setting.mockRejectedValue(new TypeError('boom'));
    await loadBillingCatalogContext();
    expect(String(mocks.logError.mock.calls[0][0])).toContain('TypeError');
  });
});
