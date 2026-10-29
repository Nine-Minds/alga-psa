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
}

const CACHE_TTL_MS = 30_000;
// Per contract currency, then per service id.
const cache = new Map<string, Map<string, CacheEntry>>();
const inFlight = new Map<string, Promise<void>>();
let cachedCanViewCost = false;

const isFresh = (entry: CacheEntry | undefined, now: number): entry is CacheEntry =>
  Boolean(entry && now - entry.fetchedAt < CACHE_TTL_MS);

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

  let byId = cache.get(currencyCode);
  if (!byId) {
    byId = new Map();
    cache.set(currencyCode, byId);
  }
  const now = Date.now();
  for (const id of ids) {
    const extra = info?.items[id];
    byId.set(id, {
      currency_rate: rateMap[id] ?? null,
      default_rate: extra?.default_rate ?? null,
      cost: extra?.cost ?? null,
      cost_currency: extra?.cost_currency ?? null,
      fetchedAt: now,
    });
  }
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
        const { fetchedAt: _fetchedAt, ...value } = entry;
        out[id] = value;
      }
    }
    return out;
    // `version` bumps when the module cache has been filled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyCode, idsKey, version]);

  return { rates, canViewCost: cachedCanViewCost, isLoading };
}
