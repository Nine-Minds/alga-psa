import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag.enabled }));

import { isCoManagedPurchaseSurfaceOpen, resolveCoManagedPurchaseAvailability, runWithBillingCatalogContext } from './co-managed-purchase-surface';

beforeEach(() => {
  flag.enabled.mockReset().mockResolvedValue(true);
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_co_managed';
  delete process.env.FORCE_CAPABILITIES;
});
afterEach(() => { delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; delete process.env.FORCE_CAPABILITIES; });

describe('co-managed purchase surface', () => {
  it('keeps bootstrap behavior and existing feature-flag semantics', async () => {
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(true);
    expect(flag.enabled).toHaveBeenCalledWith('release-v2-0-feature', { tenantId: 't' });
  });
  it('is closed without a price or when the release flag is off or unavailable', async () => {
    delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    flag.enabled.mockResolvedValue(false);
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    flag.enabled.mockRejectedValue(new Error('posthog down'));
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
  });
  it.each(['co-managed:off', 'co-managed:bogus'])('is closed under FORCE_CAPABILITIES=%s', async (force) => {
    process.env.FORCE_CAPABILITIES = force;
    expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
    expect(flag.enabled).not.toHaveBeenCalled();
  });
  it('uses request-local contexts across independent and overlapping server entry points', async () => {
    // Next can bundle the request loader and the overview with separate module instances.
    delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
    vi.resetModules();
    const reader = await import('./co-managed-purchase-surface');
    const database = { mode: 'live' as const, stripeAccount: 'acct_live', priceId: 'price_db', source: 'database' as const, sellable: true };
    const paused = { ...database, priceId: null, sellable: false };
    const [overview, purchase] = await Promise.all([
      runWithBillingCatalogContext(database, async () => {
        await Promise.resolve();
        return { open: await reader.isCoManagedPurchaseSurfaceOpen('t'), context: reader.currentBillingCatalogContext() };
      }),
      runWithBillingCatalogContext(paused, async () => ({ open: await reader.isCoManagedPurchaseSurfaceOpen('t'), context: reader.currentBillingCatalogContext() })),
    ]);
    expect(overview).toEqual({ open: true, context: database });
    expect(purchase).toEqual({ open: false, context: paused });
    expect(resolveCoManagedPurchaseAvailability({ ...database, sellable: false })).toBe(false);
    expect(resolveCoManagedPurchaseAvailability({ ...database, priceId: null })).toBe(false);
    expect(resolveCoManagedPurchaseAvailability({ ...database, stripeAccount: null })).toBe(false);
  });
});
