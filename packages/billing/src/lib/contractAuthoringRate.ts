/**
 * Shared authoring-time catalog rate resolution for contract/contract-line
 * authoring surfaces.
 *
 * Precedence (see docs/plans/2026-09-21-contract-services-catalog-rate-defaults):
 *   1. the matching current `service_prices` rate for the contract currency;
 *   2. otherwise the catalog `default_rate` when it is a finite, non-negative
 *      number;
 *   3. otherwise no resolved rate (the author must supply a manual rate).
 *
 * `default_rate` is currency-untagged. This resolver deliberately treats it as
 * a suggested authoring value rather than a currency-specific catalog price and
 * never writes a `service_prices` row.
 */

export type ContractAuthoringRateSource =
  | 'currency-price'
  | 'catalog-default'
  | 'none';

export interface ContractAuthoringRateCandidate {
  /** Current per-currency prices from `service_prices`. */
  prices?: ReadonlyArray<{
    currency_code?: string | null;
    rate?: number | string | null;
  }> | null;
  /** Currency-untagged legacy catalog rate, in integer minor units. */
  default_rate?: number | string | null;
  /** Currency-specific rate already resolved by the catalog picker. */
  currency_rate?: number | string | null;
}

export interface ResolvedContractAuthoringRate {
  /** Resolved rate in integer minor units, or null when nothing resolves. */
  rate: number | null;
  source: ContractAuthoringRateSource;
}

function normalizeNonNegativeRate(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

/**
 * Resolve the authoring rate for a catalog item (an `IService` or a
 * `CatalogPickerItem`) against the contract's currency.
 */
export function resolveContractAuthoringRate(
  candidate: ContractAuthoringRateCandidate | null | undefined,
  currencyCode: string | null | undefined,
): ResolvedContractAuthoringRate {
  if (candidate) {
    const currency = typeof currencyCode === 'string' ? currencyCode.trim() : '';

    if (currency && Array.isArray(candidate.prices)) {
      const matching = candidate.prices.find(
        (price) => price?.currency_code === currency,
      );
      const exactPrice = normalizeNonNegativeRate(matching?.rate);
      if (exactPrice !== null) {
        return { rate: exactPrice, source: 'currency-price' };
      }
    }

    // A present numeric `currency_rate` is an exact price for the requested
    // currency. `null`/`undefined` means the picker found no such row.
    if (candidate.currency_rate !== undefined) {
      const pickerPrice = normalizeNonNegativeRate(candidate.currency_rate);
      if (pickerPrice !== null) {
        return { rate: pickerPrice, source: 'currency-price' };
      }
    }

    const catalogDefault = normalizeNonNegativeRate(candidate.default_rate);
    if (catalogDefault !== null) {
      return { rate: catalogDefault, source: 'catalog-default' };
    }
  }

  return { rate: null, source: 'none' };
}
