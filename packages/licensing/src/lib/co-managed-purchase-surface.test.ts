import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag.enabled }));

import { AsyncResource } from 'node:async_hooks';
import {
  currentBillingCatalogContext, isCoManagedPurchaseSurfaceOpen, registerBillingCatalogContextLoader,
  resolveCoManagedPurchaseAvailability, runWithBillingCatalogContext, type BillingCatalogContext,
} from './co-managed-purchase-surface';

const sellable: BillingCatalogContext = { mode: 'live', stripeAccount: 'acct_live', priceId: 'price_db', source: 'database', sellable: true };
const unconfigured: BillingCatalogContext = { mode: 'live', stripeAccount: null, priceId: null, source: 'unconfigured', sellable: false };
/** A request is an independent async root; this stands in for a Next request or a Temporal activity. */
const request = <T>(work: () => Promise<T>): Promise<T> => new AsyncResource('test-request').runInAsyncScope(work);

beforeEach(() => {
  flag.enabled.mockReset().mockResolvedValue(true);
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_co_managed';
  delete process.env.FORCE_CAPABILITIES;
  registerBillingCatalogContextLoader(undefined);
});
afterEach(() => { delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; delete process.env.FORCE_CAPABILITIES; registerBillingCatalogContextLoader(undefined); });

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
        return { open: await reader.isCoManagedPurchaseSurfaceOpen('t'), context: await reader.currentBillingCatalogContext() };
      }),
      runWithBillingCatalogContext(paused, async () => ({ open: await reader.isCoManagedPurchaseSurfaceOpen('t'), context: await reader.currentBillingCatalogContext() })),
    ]);
    expect(overview).toEqual({ open: true, context: database });
    expect(purchase).toEqual({ open: false, context: paused });
    expect(resolveCoManagedPurchaseAvailability({ ...database, sellable: false })).toBe(false);
    expect(resolveCoManagedPurchaseAvailability({ ...database, priceId: null })).toBe(false);
    expect(resolveCoManagedPurchaseAvailability({ ...database, stripeAccount: null })).toBe(false);
  });

  describe('registered catalog context loader', () => {
    it('answers the same with and without a wrapper, for the gate and for currentBillingCatalogContext', async () => {
      delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID;
      registerBillingCatalogContextLoader(async () => sellable);
      const bare = await request(async () => ({ open: await isCoManagedPurchaseSurfaceOpen('t'), context: await currentBillingCatalogContext() }));
      const wrapped = await runWithBillingCatalogContext(sellable, async () => ({ open: await isCoManagedPurchaseSurfaceOpen('t'), context: await currentBillingCatalogContext() }));
      expect(bare).toEqual({ open: true, context: sellable });
      expect(wrapped).toEqual(bare);
    });
    it('prefers an explicit wrapper over the loader', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await expect(runWithBillingCatalogContext(unconfigured, () => isCoManagedPurchaseSurfaceOpen('t'))).resolves.toBe(false);
      expect(loader).not.toHaveBeenCalled();
    });
    it.each([
      ['throws', async () => { throw new Error('catalog down'); }],
      ['returns an unconfigured context', async () => unconfigured],
    ])('is closed when the loader %s, even with the legacy env price set', async (_name, loader) => {
      registerBillingCatalogContextLoader(loader);
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(false);
      expect((await request(() => currentBillingCatalogContext()))?.sellable).toBe(false);
    });
    it('keeps the env fallback only while no loader is registered', async () => {
      expect(await request(() => currentBillingCatalogContext())).toBeUndefined();
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(true);
      registerBillingCatalogContextLoader(async () => unconfigured);
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(false);
    });
    it('still applies the release flag after a sellable context', async () => {
      registerBillingCatalogContextLoader(async () => sellable);
      flag.enabled.mockResolvedValue(false);
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(false);
    });
  });

  describe('request scope', () => {
    it('loads per unscoped check and never across a scope: a scope pins one context for all its checks', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await runWithBillingCatalogContext(sellable, async () => {
        await Promise.all([isCoManagedPurchaseSurfaceOpen('t'), isCoManagedPurchaseSurfaceOpen('t')]);
        await isCoManagedPurchaseSurfaceOpen('t');
        await currentBillingCatalogContext();
      });
      expect(loader).not.toHaveBeenCalled();
      await request(() => isCoManagedPurchaseSurfaceOpen('t'));
      await request(() => isCoManagedPurchaseSurfaceOpen('t'));
      expect(loader).toHaveBeenCalledTimes(2);
    });
    it('sees a catalog change on the next check (no cross-request cache)', async () => {
      let current = sellable;
      registerBillingCatalogContextLoader(async () => current);
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(true);
      current = unconfigured;
      expect(await request(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(false);
    });
    it('does not leave a context behind after an unscoped check', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await isCoManagedPurchaseSurfaceOpen('t');
      loader.mockImplementation(async () => unconfigured);
      expect(await isCoManagedPurchaseSurfaceOpen('t')).toBe(false);
      expect(loader).toHaveBeenCalledTimes(2);
    });
    it('keeps concurrent scopes isolated', async () => {
      const unsealed = { ...sellable, priceId: null, sellable: false };
      const [a, b] = await Promise.all([
        runWithBillingCatalogContext(sellable, async () => { await new Promise((r) => setTimeout(r, 5)); return isCoManagedPurchaseSurfaceOpen('t'); }),
        runWithBillingCatalogContext(unsealed, async () => isCoManagedPurchaseSurfaceOpen('t')),
      ]);
      expect([a, b]).toEqual([true, false]);
    });
  });
});
