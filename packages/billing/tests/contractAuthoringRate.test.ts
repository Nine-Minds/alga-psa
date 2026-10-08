import { describe, expect, it } from 'vitest';
import { resolveContractAuthoringRate } from '../src/lib/contractAuthoringRate';

describe('resolveContractAuthoringRate', () => {
  it('prefers the matching contract-currency service_prices rate over default_rate', () => {
    const resolved = resolveContractAuthoringRate(
      {
        prices: [
          { currency_code: 'USD', rate: 25000 },
          { currency_code: 'EUR', rate: 21000 },
        ],
        default_rate: 18000,
      },
      'EUR',
    );

    expect(resolved).toEqual({ rate: 21000, source: 'currency-price' });
  });

  it('falls back to default_rate when no service_prices row matches the contract currency', () => {
    const resolved = resolveContractAuthoringRate(
      {
        prices: [{ currency_code: 'USD', rate: 25000 }],
        default_rate: 18000,
      },
      'EUR',
    );

    expect(resolved).toEqual({ rate: 18000, source: 'catalog-default' });
  });

  it('uses a picker-provided currency_rate ahead of default_rate', () => {
    const resolved = resolveContractAuthoringRate(
      { currency_rate: 9900, default_rate: 18000 },
      'USD',
    );

    expect(resolved).toEqual({ rate: 9900, source: 'currency-price' });
  });

  it('falls through a null picker currency_rate to the catalog default', () => {
    const resolved = resolveContractAuthoringRate(
      { currency_rate: null, default_rate: 18000 },
      'USD',
    );

    expect(resolved).toEqual({ rate: 18000, source: 'catalog-default' });
  });

  it('preserves a configured zero for both the currency price and the catalog default', () => {
    expect(
      resolveContractAuthoringRate(
        { prices: [{ currency_code: 'USD', rate: 0 }], default_rate: 18000 },
        'USD',
      ),
    ).toEqual({ rate: 0, source: 'currency-price' });

    expect(
      resolveContractAuthoringRate({ currency_rate: 0, default_rate: 18000 }, 'USD'),
    ).toEqual({ rate: 0, source: 'currency-price' });

    expect(
      resolveContractAuthoringRate({ default_rate: 0 }, 'USD'),
    ).toEqual({ rate: 0, source: 'catalog-default' });
  });

  it('reports none for invalid or absent input', () => {
    expect(resolveContractAuthoringRate(null, 'USD')).toEqual({
      rate: null,
      source: 'none',
    });
    expect(resolveContractAuthoringRate({ default_rate: null }, 'USD')).toEqual({
      rate: null,
      source: 'none',
    });
    expect(resolveContractAuthoringRate({ default_rate: -1 }, 'USD')).toEqual({
      rate: null,
      source: 'none',
    });
    expect(
      resolveContractAuthoringRate({ default_rate: Number.NaN }, 'USD'),
    ).toEqual({ rate: null, source: 'none' });
    expect(
      resolveContractAuthoringRate(
        { prices: [{ currency_code: 'USD', rate: -5 }] },
        'USD',
      ),
    ).toEqual({ rate: null, source: 'none' });
  });

  it('does not match a price for a different currency', () => {
    const resolved = resolveContractAuthoringRate(
      { prices: [{ currency_code: 'USD', rate: 25000 }] },
      'EUR',
    );

    expect(resolved).toEqual({ rate: null, source: 'none' });
  });
});
