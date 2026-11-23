/**
 * T003 (Stripe reads): one request reads the current co-managed seat price from Stripe once, however many
 * gate checks, display reads and preview reads it makes. A Co-managed IT page view measured 9 price reads
 * before this: the gate's context load and `coManagedSeatPrice` each resolved the current offer, and
 * `coManagedSeatPrice` then read the same price again.
 *
 * Real: the offer catalog (`createOfferCatalog`, its per-request `resolveCurrentOffer` and write wrappers), the
 * EE context loader body (`loadBillingCatalogContextFrom`), the licensing gate, request scope and render slot,
 * and `StripeService.coManagedSeatPrice`. Stubbed: the database rows, Stripe (a counter), the account setting.
 */
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/features', async (importOriginal) => ({ ...await importOriginal(), isFeatureFlagEnabled: async () => true }));

import {
  isCoManagedPurchaseSurfaceOpen, registerBillingCatalogContextLoader, registerBillingCatalogRenderScope,
  runWithBillingCatalogRequest,
} from '@alga-psa/licensing';
import { StripeService } from '../../../lib/stripe/StripeService';
import { CO_MANAGED_SEAT_OFFER_KEY, createOfferCatalog, UnmappedPriceError } from '../../../lib/stripe/offerCatalog';
import { loadBillingCatalogContextFrom } from '../../../lib/stripe/offerCatalog/catalogContext';

const scope = { stripeAccount: 'acct_db', livemode: false };
const price = { id: 'price_db', active: true, livemode: false, product: 'prod_seat', type: 'recurring', billing_scheme: 'per_unit',
  currency: 'eur', unit_amount: 2500, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
const version = { version_id: 'v1', version_number: 1, stripe_account: 'acct_db', livemode: false, offer_key: CO_MANAGED_SEAT_OFFER_KEY,
  billing_interval: 'month', price_id: 'price_db', product_id: 'prod_seat', is_current: true };

/** Just enough of knex for the catalog's version reads: `where(object)` filters, `first`/`select` answer. */
const db: any = (table: string) => {
  let rows: any[] = table === 'stripe_offer_versions' ? [version] : [];
  const query: any = {
    where: (match: Record<string, unknown>) => { rows = rows.filter((row) => Object.entries(match).every(([k, v]) => row[k] === v)); return query; },
    first: async () => rows[0],
    select: async () => rows,
  };
  return query;
};

const retrieve = vi.fn(async () => price);
const catalog = createOfferCatalog({ db: async () => db, scope: async () => scope, stripe: { prices: { retrieve } } as any, env: {} });
// The deployment-level account setting is read from its own table; here it agrees with the catalog.
const loaderCatalog = { ...catalog, deploymentLivemode: async () => false,
  effectiveAccountSetting: async () => ({ livemode: false, stripeAccount: 'acct_db', priceId: 'price_db',
    accountSource: 'database', priceSource: 'database setting', historicalAccounts: [] }) } as any;

function stripeService() {
  const service = new StripeService() as any;
  service.initPromise = Promise.resolve();
  service.offerCatalogInstance = catalog;
  service.stripe = { prices: { retrieve } };
  service.recognizedCoManagedPrices = async () => new Set(['price_db']);
  return service as StripeService;
}

/** One server action or page data request: an independent async root with the entry layer's scope. */
const request = <T>(work: () => Promise<T>): Promise<T> =>
  new AsyncResource('test-request').runInAsyncScope(() => runWithBillingCatalogRequest(work));

/** What getSeatTrialOfferAction does: the capability's eligibility gate, the surface gate, the display price. */
async function seatTrialOfferWork(service: StripeService) {
  const open = await isCoManagedPurchaseSurfaceOpen('sponsor') && await isCoManagedPurchaseSurfaceOpen('sponsor');
  return { open, price: await service.coManagedSeatPrice() };
}

beforeEach(() => {
  retrieve.mockClear();
  registerBillingCatalogContextLoader(() => loadBillingCatalogContextFrom(async () => loaderCatalog));
});
afterEach(() => { registerBillingCatalogContextLoader(undefined); registerBillingCatalogRenderScope(undefined); });

describe('one Stripe price read per request', () => {
  it('shares the gate context load, the display price and later offer reads in one request, and reads again next request', async () => {
    const service = stripeService();
    expect(await request(async () => {
      const work = await seatTrialOfferWork(service);
      await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month'); // e.g. a preview's new-sale terms
      return work;
    })).toEqual({ open: true, price: { unitAmount: 2500, currency: 'eur' } });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith('price_db', { stripeAccount: 'acct_db' });

    await request(() => seatTrialOfferWork(service));
    expect(retrieve).toHaveBeenCalledTimes(2); // no cross-request cache: Stripe-side changes show on the next request
  });

  it('coManagedSeatPrice makes no Stripe read of its own and still refuses an unrecognised price', async () => {
    const service = stripeService() as any;
    expect(await service.coManagedSeatPrice()).toEqual({ unitAmount: 2500, currency: 'eur' });
    expect(retrieve).toHaveBeenCalledTimes(1);
    service.recognizedCoManagedPrices = async () => new Set(['price_other']);
    await expect(service.coManagedSeatPrice()).rejects.toBeInstanceOf(UnmappedPriceError);
  });

  it('shares one read across the separate branches of a server render (root layout bootstrap, layout, page)', async () => {
    const renders = new AsyncLocalStorage<{ slot?: object }>();
    // React's cache(() => ({})) as Next runs it: one holder per render, a fresh object outside one.
    registerBillingCatalogRenderScope(() => { const store = renders.getStore(); return store ? store.slot ??= {} : {}; });
    const service = stripeService();
    const branch = <T>(work: () => Promise<T>) => new AsyncResource('render-branch').runInAsyncScope(work);
    await new AsyncResource('render').runInAsyncScope(() => renders.run({}, () => Promise.all([
      branch(() => isCoManagedPurchaseSurfaceOpen('sponsor')), // root layout capability bootstrap
      branch(() => runWithBillingCatalogRequest(() => isCoManagedPurchaseSurfaceOpen('sponsor'))), // co-managed root resolver
      branch(() => service.coManagedSeatPrice()),
    ])));
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('reads per call with no request scope (Temporal activities, scripts), as before', async () => {
    await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('re-reads within the same request after a catalog write, whether or not the write succeeds', async () => {
    await request(async () => {
      await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
      await expect(catalog.pauseSales({ actor: null, offerKey: CO_MANAGED_SEAT_OFFER_KEY, interval: 'month', expectedCurrentVersionId: 'v1' }))
        .rejects.toThrow();
      await catalog.resolveCurrentOffer(CO_MANAGED_SEAT_OFFER_KEY, 'month');
    });
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('shares a failed read within the request: the gate and the display both see the offer closed', async () => {
    retrieve.mockRejectedValueOnce(new Error('stripe down'));
    const service = stripeService();
    await request(async () => {
      expect(await isCoManagedPurchaseSurfaceOpen('sponsor')).toBe(false);
      await expect(service.coManagedSeatPrice()).rejects.toThrow();
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
});
