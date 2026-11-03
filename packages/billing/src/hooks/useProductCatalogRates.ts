'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getServiceCatalogCostInfo,
  getServiceCatalogRatesForCurrency,
} from '@alga-psa/billing/actions/serviceActions';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

/**
 * Catalog pricing for one product in a given contract currency. This is the ONE
 * lookup the contract wizard's Products step, its Review step and the Contract
 * Lines tab share, so they cannot disagree about what a catalog-priced product
 * is worth.
 *
 * Every price is keyed by its identity, (contract currency, service id) — never
 * by a row position and never copied onto a draft row — so removing a row,
 * leaving a step, resuming a draft or changing the contract currency cannot
 * attach a price to the wrong product or the wrong currency.
 */
export interface ProductCatalogRates {
  /** `service_prices.rate` in the contract currency (minor units); null when the catalog has none. */
  currency_rate: number | null;
  /** Legacy currency-untagged `service_catalog.default_rate` (minor units). */
  default_rate: number | null;
  /** Catalog cost (minor units). Null when absent OR when the caller may not see cost. */
  cost: number | null;
  /** Currency of `cost`; it can differ from the contract currency and is never converted. */
  cost_currency: string | null;
}

interface CacheEntry extends ProductCatalogRates {
  fetchedAt: number;
  /**
   * False for an entry primed from a picker selection: its price is known but its
   * cost (and the caller's cost visibility) is not, so the hook still fetches it.
   */
  complete: boolean;
}

const CACHE_TTL_MS = 30_000;
// Per contract currency, then per service id.
const cache = new Map<string, Map<string, CacheEntry>>();
const inFlight = new Map<string, Promise<void>>();
let cachedCanViewCost = false;

const isFresh = (entry: CacheEntry | undefined, now: number): entry is CacheEntry =>
  Boolean(entry && entry.complete && now - entry.fetchedAt < CACHE_TTL_MS);

function entriesFor(currencyCode: string): Map<string, CacheEntry> {
  let byId = cache.get(currencyCode);
  if (!byId) {
    byId = new Map();
    cache.set(currencyCode, byId);
  }
  return byId;
}

async function loadMissing(currencyCode: string, ids: string[]): Promise<void> {
  const [rates, costInfo] = await Promise.all([
    getServiceCatalogRatesForCurrency(ids, currencyCode),
    getServiceCatalogCostInfo(ids),
  ]);
  const rateMap =
    rates && !isActionMessageError(rates) && !isActionPermissionError(rates)
      ? (rates as Record<string, number | null>)
      : null;
  const info =
    costInfo && !isActionMessageError(costInfo) && !isActionPermissionError(costInfo) ? costInfo : null;
  // A failed lookup is not cached: leaving it out lets the next render retry.
  if (!rateMap) return;
  if (info) cachedCanViewCost = info.canViewCost;

  const byId = entriesFor(currencyCode);
  const now = Date.now();
  for (const id of ids) {
    const extra = info?.items[id];
    byId.set(id, {
      currency_rate: rateMap[id] ?? null,
      default_rate: extra?.default_rate ?? null,
      cost: extra?.cost ?? null,
      cost_currency: extra?.cost_currency ?? null,
      fetchedAt: now,
      // Without the cost lookup the entry is price-only; a later render retries the rest.
      complete: info !== null,
    });
  }
}

/**
 * Record a catalog price that is already in hand (a picker row fetched in the
 * contract currency) so the selection shows its price immediately instead of
 * flashing "unknown" until the lookup returns. The entry is keyed by the same
 * (currency, service) identity as every lookup, and is marked incomplete so
 * the hook still fetches cost for it. A complete entry is never downgraded.
 */
export function primeProductCatalogRates(
  currencyCode: string | null | undefined,
  serviceId: string | null | undefined,
  rates: Pick<ProductCatalogRates, 'currency_rate' | 'default_rate'>,
): void {
  if (!currencyCode || !serviceId) return;
  const byId = entriesFor(currencyCode);
  if (byId.get(serviceId)?.complete) return;
  byId.set(serviceId, {
    currency_rate: rates.currency_rate,
    default_rate: rates.default_rate,
    cost: null,
    cost_currency: null,
    fetchedAt: Date.now(),
    complete: false,
  });
}

/** Test seam: drop everything this module remembers. */
export function resetProductCatalogRatesCache(): void {
  cache.clear();
  inFlight.clear();
  cachedCanViewCost = false;
}

export function useProductCatalogRates(
  currencyCode: string | null | undefined,
  productIds: ReadonlyArray<string | null | undefined>,
): {
  rates: Record<string, ProductCatalogRates | undefined>;
  /** True when the caller may see catalog cost; cost must not be rendered otherwise. */
  canViewCost: boolean;
  isLoading: boolean;
} {
  const idsKey = Array.from(new Set(productIds.filter((id): id is string => Boolean(id)))).sort().join(',');
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currencyCode || !idsKey) return;
    const now = Date.now();
    const byId = cache.get(currencyCode);
    const missing = idsKey.split(',').filter((id) => !isFresh(byId?.get(id), now));
    if (missing.length === 0) return;

    let cancelled = false;
    const requestKey = `${currencyCode}:${missing.join(',')}`;
    let request = inFlight.get(requestKey);
    if (!request) {
      request = loadMissing(currencyCode, missing)
        .catch((error) => console.error('Error loading product catalog prices:', error))
        .finally(() => inFlight.delete(requestKey));
      inFlight.set(requestKey, request);
    }
    setIsLoading(true);
    request.then(() => {
      if (cancelled) return;
      setIsLoading(false);
      setVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [currencyCode, idsKey]);

  const rates = useMemo(() => {
    const out: Record<string, ProductCatalogRates | undefined> = {};
    if (!currencyCode || !idsKey) return out;
    const byId = cache.get(currencyCode);
    for (const id of idsKey.split(',')) {
      const entry = byId?.get(id);
      if (entry) {
        out[id] = {
          currency_rate: entry.currency_rate,
          default_rate: entry.default_rate,
          cost: entry.cost,
          cost_currency: entry.cost_currency,
        };
      }
    }
    return out;
    // `version` bumps when the module cache has been filled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyCode, idsKey, version]);

  return { rates, canViewCost: cachedCanViewCost, isLoading };
}
