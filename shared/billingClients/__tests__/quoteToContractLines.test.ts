import { describe, expect, it } from 'vitest';
import type { IQuoteItem } from '@alga-psa/types';
import {
  assertRecurringItemsConvertible,
  bundleLineTotal,
  getContractLineBillingTiming,
  isUnitPricedRecurringItem,
  mapQuoteItemToContractLineType,
  serviceLessRecurringMessage,
  toDateOnlyInTimeZone,
} from '../quoteToContractLines';
import { resolveFixedLineRate } from '../resolveFixedLineRate';

const CATALOG_SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCTS = new Set([PRODUCT_SERVICE_ID]);

function quoteItem(overrides: Partial<IQuoteItem> = {}): IQuoteItem {
  return {
    quote_item_id: 'item-1',
    quote_id: 'quote-1',
    description: 'Managed endpoints',
    quantity: 1,
    unit_price: 5000,
    total_price: 5000,
    is_optional: false,
    is_selected: true,
    is_recurring: true,
    is_discount: false,
    billing_method: 'fixed',
    service_id: CATALOG_SERVICE_ID,
    ...overrides,
  } as IQuoteItem;
}

describe('quote item -> contract line classification', () => {
  it('a catalog service with an integer quantity is a per-unit (seat) line', () => {
    const item = quoteItem({ quantity: 10, unit_price: 5000 });
    const lineType = mapQuoteItemToContractLineType(item);
    expect(lineType).toBe('Fixed');
    expect(isUnitPricedRecurringItem(item, lineType, PRODUCTS)).toBe(true);
    expect(getContractLineBillingTiming(item)).toBe('advance');
  });

  it('a fractional quantity is not a seat count: the line is bundle priced at quantity x price', () => {
    // quote_items.quantity is bigint in the database, so this rule is only
    // reachable through a non-integer in-memory quantity (imports, API callers).
    const item = quoteItem({ quantity: 2.5 as unknown as number, unit_price: 5000 });
    expect(isUnitPricedRecurringItem(item, 'Fixed', PRODUCTS)).toBe(false);
    expect(bundleLineTotal(item, PRODUCTS)).toBe(12500);
  });

  it('rounds a bundle total to whole cents', () => {
    const item = quoteItem({ quantity: 1.5 as unknown as number, unit_price: 333 });
    expect(bundleLineTotal(item, PRODUCTS)).toBe(500);
  });

  it('a custom item with no catalog service stays bundle priced at quantity x price', () => {
    const item = quoteItem({ service_id: null as unknown as string, quantity: 3, unit_price: 5000 });
    expect(isUnitPricedRecurringItem(item, 'Fixed', PRODUCTS)).toBe(false);
    expect(bundleLineTotal(item, PRODUCTS)).toBe(15000);
  });

  it('a product is never a unit line and keeps its unit price on the line', () => {
    const item = quoteItem({ service_id: PRODUCT_SERVICE_ID, quantity: 3, unit_price: 5000 });
    expect(isUnitPricedRecurringItem(item, 'Fixed', PRODUCTS)).toBe(false);
    expect(bundleLineTotal(item, PRODUCTS)).toBe(5000);
  });

  it('hourly and usage items are their own line types, billed in arrears', () => {
    const hourly = quoteItem({ billing_method: 'hourly' });
    const usage = quoteItem({ billing_method: 'usage' });
    expect(mapQuoteItemToContractLineType(hourly)).toBe('Hourly');
    expect(mapQuoteItemToContractLineType(usage)).toBe('Usage');
    expect(isUnitPricedRecurringItem(hourly, 'Hourly', PRODUCTS)).toBe(false);
    expect(isUnitPricedRecurringItem(usage, 'Usage', PRODUCTS)).toBe(false);
    expect(getContractLineBillingTiming(hourly)).toBe('arrears');
    expect(getContractLineBillingTiming(usage)).toBe('arrears');
  });
});

describe('service-less recurring items are refused', () => {
  it('names the offending item, with the message both conversion paths show', () => {
    const items = [
      quoteItem(),
      quoteItem({ quote_item_id: 'item-2', description: 'Ad-hoc retainer', service_id: null as unknown as string, quantity: 3 }),
    ];
    expect(() => assertRecurringItemsConvertible(items)).toThrow(
      'Recurring item "Ad-hoc retainer" must reference a catalog service before contract conversion',
    );
    expect(serviceLessRecurringMessage(items[1])).toBe(
      'Recurring item "Ad-hoc retainer" must reference a catalog service before contract conversion',
    );
  });

  it('accepts items that all carry a catalog service', () => {
    expect(() => assertRecurringItemsConvertible([quoteItem({ quantity: 10 })])).not.toThrow();
  });
});

describe('what the billing engine resolves from the written rows', () => {
  const period = { start: '2026-04-01', end: '2026-05-01' };
  const resolve = (
    line: { custom_rate: number | null },
    member: { service_base_rate: number | null; base_rate_basis?: string; pricing_basis?: string; quantity: number },
  ) => resolveFixedLineRate({
    line: { contract_line_id: 'line-1', custom_rate: line.custom_rate, rate_provenance: line.custom_rate === null ? 'inherited' : 'custom' },
    planServices: [{
      service_id: CATALOG_SERVICE_ID,
      config_id: 'config-1',
      configuration_quantity: member.quantity,
      service_base_rate: member.service_base_rate,
      base_rate_provenance: 'custom',
      base_rate_basis: member.base_rate_basis,
      pricing_basis: member.pricing_basis,
    }],
    schedules: [],
    revisions: [],
    catalogPrices: [],
    period,
    currency: 'USD',
  }).line.rateCents;

  it('a 10 x $50 seat line bills $500 per period', () => {
    // What the shared builder writes for a catalog service with quantity 10:
    // no line rate, $50 per unit on the member, quantity on the configuration.
    expect(resolve(
      { custom_rate: null },
      { service_base_rate: 5000, base_rate_basis: 'per_unit', pricing_basis: 'unit', quantity: 10 },
    )).toBe(50000);
  });

  it('the old workflow rows billed $50: the unit price as the whole line fee', () => {
    // Regression guard for the defect: crmWorkerDal wrote the unit price into
    // contract_lines.custom_rate, which the engine takes as the whole fee.
    expect(resolve(
      { custom_rate: 5000 },
      { service_base_rate: 5000, base_rate_basis: 'per_unit', quantity: 10 },
    )).toBe(5000);
  });

  it('a bundle-priced line bills the quoted recurring amount once', () => {
    // 3 x $50 with no catalog service: the line carries quantity x unit price.
    expect(resolve(
      { custom_rate: 15000 },
      { service_base_rate: 15000, base_rate_basis: 'share', quantity: 3 },
    )).toBe(15000);
  });
});

describe('toDateOnlyInTimeZone', () => {
  it('reads an acceptance instant as the tenant calendar day', () => {
    expect(toDateOnlyInTimeZone('2026-03-15T02:00:00.000Z', 'America/New_York')).toBe('2026-03-14');
    expect(toDateOnlyInTimeZone('2026-03-15T02:00:00.000Z', 'UTC')).toBe('2026-03-15');
    expect(toDateOnlyInTimeZone('2026-03-14T20:00:00.000Z', 'Pacific/Auckland')).toBe('2026-03-15');
  });

  it('passes a date-only value through untouched', () => {
    expect(toDateOnlyInTimeZone('2026-03-14', 'Pacific/Auckland')).toBe('2026-03-14');
  });
});
