import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The worker registers the billing catalog context loader (worker.ts main(), through workerRegistration.ts),
// so `co-managed-seat` decisions made here follow the DB catalog like the web server's.
const stub = vi.hoisted(() => ({
  catalog: {
    deploymentLivemode: vi.fn(async () => false),
    effectiveAccountSetting: vi.fn(),
    resolveCurrentOffer: vi.fn(),
  },
  build: vi.fn(),
  adminConnection: vi.fn(async () => ({ fake: 'admin-connection' })),
}));

vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: async () => true }));
vi.mock('@alga-psa/db', async (importOriginal) => ({ ...await importOriginal<typeof import('@alga-psa/db')>(), getAdminConnection: stub.adminConnection }));
vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/core/secrets')>(),
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
}));
vi.mock('@ee/lib/stripe/offerCatalog/catalogFactory', async (importOriginal) => ({
  ...await importOriginal<typeof import('@ee/lib/stripe/offerCatalog/catalogFactory')>(),
  createBillingOfferCatalog: (input: unknown) => { stub.build(input); return stub.catalog; },
}));

const REGISTRY = Symbol.for('@alga-psa/licensing/billing-catalog-context-loader');
const registry = () => (globalThis as Record<symbol, { loader?: unknown } | undefined>)[REGISTRY];

const sellableSetting = { stripeAccount: 'acct_db', priceId: 'price_db', accountSource: 'database', priceSource: 'database setting', historicalAccounts: [] };
const unconfiguredSetting = { stripeAccount: null, priceId: null, accountSource: 'unconfigured', priceSource: 'unconfigured', historicalAccounts: [] };

describe('temporal worker billing catalog loader', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_worker');
    vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', undefined);
    delete process.env.FORCE_CAPABILITIES;
    stub.build.mockClear();
    stub.catalog.effectiveAccountSetting.mockResolvedValue(sellableSetting);
    stub.catalog.resolveCurrentOffer.mockResolvedValue({ priceId: 'price_db', scope: { stripeAccount: 'acct_db', livemode: false } });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('importing the registration registers a loader, and the gate follows the catalog rather than the env var', async () => {
    const licensing = await import('@alga-psa/licensing');
    licensing.registerBillingCatalogContextLoader(undefined);
    expect(registry()?.loader).toBeUndefined();
    await import('@ee/lib/stripe/offerCatalog/workerRegistration');
    expect(typeof registry()?.loader).toBe('function');

    // Catalog sellable, env unset: open.
    expect(await licensing.isCoManagedPurchaseSurfaceOpen('tenant')).toBe(true);
    expect(stub.build).toHaveBeenCalledWith(expect.objectContaining({ secretKey: 'sk_test_worker', db: { fake: 'admin-connection' } }));

    // Catalog unconfigured, env set: closed (a registered loader never falls back to the env var).
    vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', 'price_env');
    stub.catalog.effectiveAccountSetting.mockResolvedValue(unconfiguredSetting);
    expect(await licensing.isCoManagedPurchaseSurfaceOpen('tenant')).toBe(false);

    // Each load asks for a fresh admin connection: nothing is held across loads.
    const before = stub.adminConnection.mock.calls.length;
    await licensing.isCoManagedPurchaseSurfaceOpen('tenant');
    expect(stub.adminConnection.mock.calls.length).toBe(before + 1);
  });

  it('fails closed, without throwing, when no Stripe key can be resolved', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { loadWorkerBillingCatalogContext } = await import('@ee/lib/stripe/offerCatalog/workerRegistration');
    expect(await loadWorkerBillingCatalogContext()).toMatchObject({ sellable: false, source: 'unconfigured' });
  });
});
