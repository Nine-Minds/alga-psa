import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag.enabled }));

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import {
  currentBillingCatalogContext, isCoManagedPurchaseSurfaceOpen, registerBillingCatalogContextLoader,
  registerBillingCatalogRenderScope, memoiseInBillingCatalogRequest, forgetBillingCatalogRequest,
  resolveCoManagedPurchaseAvailability, runWithBillingCatalogContext, runWithBillingCatalogRequest, hasBillingCatalogScope, type BillingCatalogContext,
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
  registerBillingCatalogRenderScope(undefined);
});
afterEach(() => { delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; delete process.env.FORCE_CAPABILITIES; registerBillingCatalogContextLoader(undefined); registerBillingCatalogRenderScope(undefined); });

/**
 * Stands in for React's `cache(() => ({}))` as Next uses it: one holder per render request, and outside a
 * render (no request cache) a fresh object on every call.
 */
const renders = new AsyncLocalStorage<Map<string, object>>();
const renderSlot = () => {
  const cache = renders.getStore();
  if (!cache) return {};
  let holder = cache.get('slot');
  if (!holder) cache.set('slot', holder = {});
  return holder;
};
const render = <T>(work: () => Promise<T>): Promise<T> => request(() => renders.run(new Map(), work));

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

  describe('lazy request scope (runWithBillingCatalogRequest: the entry-point mechanism)', () => {
    it('loads once for many sequential and concurrent gate checks, and again for the next request', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      const checks = () => runWithBillingCatalogRequest(async () => {
        const concurrent = await Promise.all([isCoManagedPurchaseSurfaceOpen('t'), isCoManagedPurchaseSurfaceOpen('t')]);
        await Promise.resolve();
        return [...concurrent, await isCoManagedPurchaseSurfaceOpen('t'), (await currentBillingCatalogContext())?.sellable];
      });
      expect(await request(checks)).toEqual([true, true, true, true]);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(await request(checks)).toEqual([true, true, true, true]);
      expect(loader).toHaveBeenCalledTimes(2);
    });
    it('loads nothing when the request never reaches the gate', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await request(() => runWithBillingCatalogRequest(async () => { expect(hasBillingCatalogScope()).toBe(true); }));
      expect(loader).not.toHaveBeenCalled();
    });
    it('answers the same as a pinned scope and as no scope, including when the loader throws or is unconfigured', async () => {
      for (const loader of [async () => sellable, async () => unconfigured, async () => { throw new Error('down'); }]) {
        registerBillingCatalogContextLoader(loader);
        const bare = await request(() => isCoManagedPurchaseSurfaceOpen('t'));
        const lazy = await request(() => runWithBillingCatalogRequest(() => isCoManagedPurchaseSurfaceOpen('t')));
        expect(lazy).toBe(bare);
      }
      registerBillingCatalogContextLoader(async () => { throw new Error('down'); });
      expect(await request(() => runWithBillingCatalogRequest(() => isCoManagedPurchaseSurfaceOpen('t')))).toBe(false); // env var is set
    });
    it('keeps the env fallback with no loader registered, inside a scope too', async () => {
      expect(await request(() => runWithBillingCatalogRequest(() => isCoManagedPurchaseSurfaceOpen('t')))).toBe(true);
    });
    it('joins an open scope and defers to an explicit pinned one', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await request(() => runWithBillingCatalogRequest(() => runWithBillingCatalogRequest(async () => {
        await isCoManagedPurchaseSurfaceOpen('t');
        await runWithBillingCatalogRequest(() => isCoManagedPurchaseSurfaceOpen('t'));
      })));
      expect(loader).toHaveBeenCalledTimes(1);
      loader.mockClear();
      expect(await request(() => runWithBillingCatalogRequest(() => runWithBillingCatalogContext(unconfigured, () => isCoManagedPurchaseSurfaceOpen('t'))))).toBe(false);
      expect(loader).not.toHaveBeenCalled();
    });
    it('does not leak into work outside the scope, and concurrent requests do not share a load', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      await Promise.all([
        request(() => runWithBillingCatalogRequest(async () => { await isCoManagedPurchaseSurfaceOpen('t'); await isCoManagedPurchaseSurfaceOpen('t'); })),
        request(() => runWithBillingCatalogRequest(async () => { await isCoManagedPurchaseSurfaceOpen('t'); await isCoManagedPurchaseSurfaceOpen('t'); })),
      ]);
      expect(loader).toHaveBeenCalledTimes(2);
      expect(hasBillingCatalogScope()).toBe(false);
      await isCoManagedPurchaseSurfaceOpen('t');
      expect(loader).toHaveBeenCalledTimes(3);
    });
  });
  });
  describe('server render scope (registerBillingCatalogRenderScope: one load per render)', () => {
    it('shares one load across the separate branches of one render, and loads again for the next render', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      registerBillingCatalogRenderScope(renderSlot);
      // Root layout bootstrap, the co-managed resolver (which opens a request scope: it joins the render) and
      // a nested branch, concurrently, as React renders them.
      const answers = await render(() => Promise.all([
        request(() => isCoManagedPurchaseSurfaceOpen('t')),
        request(() => runWithBillingCatalogRequest(async () => [await isCoManagedPurchaseSurfaceOpen('t'), await isCoManagedPurchaseSurfaceOpen('t')])),
        request(async () => (await currentBillingCatalogContext())?.priceId),
      ]));
      expect(answers).toEqual([true, [true, true], 'price_db']);
      expect(loader).toHaveBeenCalledTimes(1);
      await render(() => isCoManagedPurchaseSurfaceOpen('t'));
      expect(loader).toHaveBeenCalledTimes(2);
    });
    it('is no scope at all outside a render, even with a slot registered (never a process cache)', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      registerBillingCatalogRenderScope(renderSlot);
      expect(hasBillingCatalogScope()).toBe(false);
      await isCoManagedPurchaseSurfaceOpen('t');
      await isCoManagedPurchaseSurfaceOpen('t');
      expect(loader).toHaveBeenCalledTimes(2);
    });
    it('lets a pinned context inside a render win, and a slot that throws count as no scope', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      registerBillingCatalogRenderScope(renderSlot);
      expect(await render(() => runWithBillingCatalogContext(unconfigured, () => isCoManagedPurchaseSurfaceOpen('t')))).toBe(false);
      expect(loader).not.toHaveBeenCalled();
      registerBillingCatalogRenderScope(() => { throw new Error('not in a render'); });
      expect(await render(() => isCoManagedPurchaseSurfaceOpen('t'))).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('request memo (memoiseInBillingCatalogRequest / forgetBillingCatalogRequest)', () => {
    it('runs a catalog read once per request scope, concurrent calls included, and per call with no scope', async () => {
      const read = vi.fn(async () => 'price_db');
      await request(() => runWithBillingCatalogRequest(async () => {
        expect(await Promise.all([memoiseInBillingCatalogRequest('k', read), memoiseInBillingCatalogRequest('k', read)])).toEqual(['price_db', 'price_db']);
        await memoiseInBillingCatalogRequest('k', read);
      }));
      expect(read).toHaveBeenCalledTimes(1);
      await request(() => runWithBillingCatalogRequest(() => memoiseInBillingCatalogRequest('k', read)));
      expect(read).toHaveBeenCalledTimes(2);
      await memoiseInBillingCatalogRequest('k', read);
      await memoiseInBillingCatalogRequest('k', read);
      expect(read).toHaveBeenCalledTimes(4);
    });
    it('shares a failure within the request rather than retrying, and keeps keys apart', async () => {
      const failing = vi.fn(async () => { throw new Error('stripe down'); });
      const other = vi.fn(async () => 'other');
      await request(() => runWithBillingCatalogRequest(async () => {
        await expect(memoiseInBillingCatalogRequest('a', failing)).rejects.toThrow('stripe down');
        await expect(memoiseInBillingCatalogRequest('a', failing)).rejects.toThrow('stripe down');
        expect(await memoiseInBillingCatalogRequest('b', other)).toBe('other');
      }));
      expect(failing).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(1);
    });
    it('after a catalog write in the request, re-reads and reloads the lazy context but keeps a pinned one', async () => {
      const loader = vi.fn(async () => sellable);
      registerBillingCatalogContextLoader(loader);
      const read = vi.fn(async () => 'v');
      await request(() => runWithBillingCatalogRequest(async () => {
        await isCoManagedPurchaseSurfaceOpen('t');
        await memoiseInBillingCatalogRequest('k', read);
        forgetBillingCatalogRequest();
        await isCoManagedPurchaseSurfaceOpen('t');
        await memoiseInBillingCatalogRequest('k', read);
      }));
      expect(loader).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(2);
      loader.mockClear();
      expect(await request(() => runWithBillingCatalogContext(unconfigured, async () => {
        forgetBillingCatalogRequest();
        return isCoManagedPurchaseSurfaceOpen('t');
      }))).toBe(false);
      expect(loader).not.toHaveBeenCalled();
      forgetBillingCatalogRequest(); // no scope: a no-op
    });
  });
});
