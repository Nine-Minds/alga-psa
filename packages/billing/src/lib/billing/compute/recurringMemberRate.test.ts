import { describe, expect, it } from 'vitest';
import type { IClientContractLine } from '@alga-psa/types';
import { computeRecurringQuantityCharges } from './computeRecurringQuantityCharges';
import {
  resolveEffectiveLineRate,
  resolveFixedLineRecurringTotal,
  resolveRecurringMemberRate,
} from './recurringMemberRate';
import type { ChargeComputeTaxPorts, ChargeComputeTiming } from './types';

// alga-2026-0002714: Lynda's "M365 Agreement" — AUD, 5 x 16098, 5 x 18000, 5 x 9000 (cents).
const M365 = [
  { service_id: 's1', service_name: 'M365 A', price_rate: 16098, quantity: 5 },
  { service_id: 's2', service_name: 'M365 B', price_rate: 18000, quantity: 5 },
  { service_id: 's3', service_name: 'M365 C', price_rate: 9000, quantity: 5 },
];
const M365_PER_MONTH_CENTS = 215_490; // $2,154.90 AUD

const NO_TAX: ChargeComputeTaxPorts = {
  getTaxInfoFromService: () => ({ taxRegion: null, isTaxable: false }),
  getLocationTaxRegionCode: () => null,
  getClientDefaultTaxRegionCode: () => null,
  isTaxExemptForProfile: () => false,
  calculateTax: () => ({ taxRate: 0, taxAmount: 0 }),
};
const timing: ChargeComputeTiming = {
  duePosition: 'arrears',
  servicePeriodStart: '2026-08-01',
  servicePeriodEnd: '2026-08-31',
  servicePeriodStartExclusive: '2026-08-01',
  servicePeriodEndExclusive: '2026-09-01',
  coverageRatio: 1,
};

describe('resolveRecurringMemberRate', () => {
  it('follows configuration ?? service line ?? currency price ?? default_rate', () => {
    expect(resolveRecurringMemberRate({ configuration_custom_rate: 1, service_line_custom_rate: 2, price_rate: 3, default_rate: 4 }))
      .toEqual({ rateCents: 1, source: 'configuration override' });
    expect(resolveRecurringMemberRate({ service_line_custom_rate: 2, price_rate: 3, default_rate: 4 }))
      .toEqual({ rateCents: 2, source: 'service override' });
    expect(resolveRecurringMemberRate({ price_rate: 3, default_rate: 4 }))
      .toEqual({ rateCents: 3, source: 'currency catalog price' });
    expect(resolveRecurringMemberRate({ default_rate: '4' }).rateCents).toBe(4);
    expect(resolveRecurringMemberRate({}).rateCents).toBe(0);
  });
});

describe('Products-only AUD contract (customer shape)', () => {
  const members = M365.map((m) => ({ ...m, item_kind: 'product' }));

  it('resolver values it at $2,154.90 with a placeholder 0 line rate, and with no line rate', () => {
    expect(resolveFixedLineRecurringTotal({ custom_rate: 0, members }, 'monthly')).toBe(M365_PER_MONTH_CENTS);
    expect(resolveFixedLineRecurringTotal({ custom_rate: null, members }, 'monthly')).toBe(M365_PER_MONTH_CENTS);
    expect(resolveFixedLineRecurringTotal({ custom_rate: '0.00', members }, 'monthly')).toBe(M365_PER_MONTH_CENTS);
  });

  it('engine recurring charges agree with the resolver', () => {
    const result = computeRecurringQuantityCharges(
      {
        clientContractLine: { client_contract_line_id: 'ccl', client_id: 'c', contract_line_id: 'cl', enable_proration: false } as IClientContractLine,
        client: { client_id: 'c', is_tax_exempt: false },
        timing,
        chargeType: 'product',
        contractCurrency: 'AUD',
        services: M365.map((m) => ({
          service_id: m.service_id,
          service_name: m.service_name,
          default_rate: 0,
          configuration_quantity: m.quantity,
          price_rate: m.price_rate,
        })),
      },
      NO_TAX,
    );
    expect(result.charges.map((c) => c.total)).toEqual([80_490, 90_000, 45_000]);
    expect(result.charges.reduce((s, c) => s + c.total, 0)).toBe(M365_PER_MONTH_CENTS);
  });

  it('a real (non-zero) line override still wins; a zero on a line without priced products is kept', () => {
    expect(resolveFixedLineRecurringTotal({ custom_rate: 5000, members }, 'monthly')).toBe(5000);
    expect(resolveEffectiveLineRate(0, [{ item_kind: 'service' }])).toBe(0);
    expect(resolveEffectiveLineRate(0, [])).toBe(0);
    expect(resolveEffectiveLineRate(null, members)).toBeNull();
  });

  it('a product whose catalog price really is 0 totals 0', () => {
    const free = [{ item_kind: 'product', quantity: 5, price_rate: 0, default_rate: 999 }];
    expect(resolveFixedLineRecurringTotal({ custom_rate: 0, members: free }, 'monthly')).toBe(0);
  });

  it('returns null for non-product lines so their valuation is unchanged', () => {
    expect(resolveFixedLineRecurringTotal({ custom_rate: 100, members: [{ item_kind: 'service', default_rate: 5 }] }, 'monthly')).toBeNull();
  });

  it('normalizes to monthly by the line frequency', () => {
    expect(resolveFixedLineRecurringTotal({ custom_rate: null, billing_frequency: 'annually', members }, 'monthly'))
      .toBe(Math.round(M365_PER_MONTH_CENTS / 12));
  });
});
