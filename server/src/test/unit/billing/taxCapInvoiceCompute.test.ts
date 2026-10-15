import { describe, expect, it, vi } from 'vitest';
import type { IClientContractLine } from '@alga-psa/types';
import { normalizeTaxCapAmount, regionalTaxAmount, toRational } from '@alga-psa/billing/lib/billing/taxCapMath';
import { buildChargeComputeTaxContext, type LoadedChargeTaxRate } from '@alga-psa/billing/lib/billing/compute/taxContext';
import { computeRecurringQuantityCharges } from '@alga-psa/billing/lib/billing/compute/computeRecurringQuantityCharges';

function rate(overrides: Partial<LoadedChargeTaxRate> = {}): LoadedChargeTaxRate {
  return { taxRateId: 'rate', regionCode: 'GB', percentage: 10, isActive: true,
    startDate: '2026-01-01', endDate: null, currencyCode: 'GBP', capAmount: null, ...overrides };
}

function context(rates: LoadedChargeTaxRate[], overrides: Partial<Parameters<typeof buildChargeComputeTaxContext>[0]> = {}) {
  return buildChargeComputeTaxContext({ clientId: 'client', clientIsTaxExempt: false,
    reverseCharge: false, clientDefaultRegion: 'GB', locationRegions: new Map(), rates, ...overrides });
}

const calculate = (tax: ReturnType<typeof context>, amount = 10000, currency = 'GBP') =>
  tax.calculateTax('client', amount, '2026-06-01', 'GB', true, currency);

describe('stored tax cap normalization', () => {
  it.each([true, false])('rejects boolean %s instead of coercing it to an amount', value => {
    expect(() => normalizeTaxCapAmount(value as any)).toThrow('non-negative whole number');
  });
  it.each([null, undefined])('normalizes absent %s to null', (value) => {
    expect(normalizeTaxCapAmount(value)).toBeNull();
  });
  it.each([0, '0', ' 0 ', Number.MAX_SAFE_INTEGER, '9007199254740991'])('preserves safe integer %s', (value) => {
    expect(normalizeTaxCapAmount(value)).toBe(Number(value));
  });
  it.each(['', ' ', '-1', '+1', '1e2', '0xff', '12garbage', '1.0', '9007199254740990.1',
    '9007199254740992', 'NaN', 'Infinity', '1 0', -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s without coercing fractional or malformed strings into valid integers', (value) => {
      expect(() => normalizeTaxCapAmount(value)).toThrow('non-negative whole number');
    });
});

describe('preloaded invoice tax uses the parent regional calculation', () => {
  it.each([[null, 1000], ['500', 500], [300, 300], [0, 0]] as const)(
    'supports persisted cap %s as tax %s', (capAmount, expected) => {
      expect(calculate(context([rate({ capAmount })]))).toEqual({ taxAmount: expected, taxRate: 10 });
    });
  it('caps each contribution and each calculation, not their combined total', () => {
    const tax = context([rate({ capAmount: 300 }), rate({ taxRateId: 'second', percentage: 5, capAmount: 200 })]);
    expect(calculate(tax).taxAmount).toBe(500);
    expect(calculate(tax).taxAmount + calculate(tax).taxAmount).toBe(1000);
  });
  it('retains universal legacy caps and selects only matching explicit currencies', () => {
    const tax = context([rate({ capAmount: 300 }), rate({ taxRateId: 'legacy', currencyCode: null, capAmount: '200' })]);
    expect(calculate(tax).taxAmount).toBe(500);
    expect(calculate(tax, 10000, 'JPY').taxAmount).toBe(200);
  });
  it('retains missing-rate, exemption, reverse-charge, validity, and client boundaries', () => {
    const onMissingRate = vi.fn();
    expect(calculate(context([rate({ endDate: '2026-06-01' })], { onMissingRate })).taxAmount).toBe(0);
    expect(onMissingRate).toHaveBeenCalledWith({ regionCode: 'GB', date: '2026-06-01', currencyCode: 'GBP' });
    for (const overrides of [{ clientIsTaxExempt: true }, { reverseCharge: true }]) {
      expect(calculate(context([rate({ capAmount: 300 })], overrides)).taxAmount).toBe(0);
    }
    const tax = context([rate({ capAmount: 300 })]);
    expect(tax.calculateTax('other-client', 10000, '2026-06-01', 'GB', true, 'GBP').taxAmount).toBe(0);
    expect(calculate(tax, -100).taxAmount).toBe(0);
  });
  it('keeps uncapped and nonbinding-cap results bit-identical to the parent expression', () => {
    for (const amount of [1, 13, 325, 999, 10000, 123456789]) {
      for (const percentages of [[1.1, 2.9], [7.25, 0.375], [0, 0], [10, 20]]) {
        const combined = percentages.reduce((sum, value) => sum + value, 0);
        for (const capAmount of [null, Number.MAX_SAFE_INTEGER]) {
          const rates = percentages.map((percentage) => rate({ percentage, capAmount }));
          expect(calculate(context(rates), amount).taxAmount).toBe(Math.ceil(amount * combined / 100));
        }
      }
    }
  });
  it('sums binding contributions exactly before ceiling rounding', () => {
    const tax = context([rate({ percentage: 1.1 }), rate({ percentage: 2.9 }), rate({ percentage: 50, capAmount: 0 })]);
    expect(calculate(tax, 325).taxAmount).toBe(13);
    expect(regionalTaxAmount(325, toRational(325), [
      { percentage: 1.1, cap: null }, { percentage: 2.9, cap: null }, { percentage: 50, cap: 0 },
    ], 54)).toBe(13);
  });
});

describe('configured caps reach production recurring charge results', () => {
  it.each([[null, 1000], ['500', 500], ['300', 300], [null, 1000], ['0', 0]] as const)(
    'carries cap %s to draft charge tax %s using resolved invoice currency', (capAmount, expected) => {
      const result = computeRecurringQuantityCharges({
        // Currency is already resolved by the loader; a partial line must not replace it with USD.
        clientContractLine: { client_contract_line_id: 'line' } as IClientContractLine,
        client: { client_id: 'client' }, chargeType: 'product', contractCurrency: 'GBP',
        timing: { duePosition: 'arrears', servicePeriodStart: '2026-05-01', servicePeriodEnd: '2026-06-01',
          servicePeriodStartExclusive: '2026-05-01', servicePeriodEndExclusive: '2026-06-01', coverageRatio: 1 },
        services: [{ service_id: 'service', service_name: 'Tax cap fixture', tax_rate_id: 'rate', price_rate: 10000 }],
      }, context([rate({ capAmount })]));
      expect(result.charges).toHaveLength(1);
      expect(result.charges[0]).toMatchObject({ total: 10000, tax_amount: expected, tax_rate: 10 });
    });
});
