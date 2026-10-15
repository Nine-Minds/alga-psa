import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem } from '@alga-psa/types';

// The preview must mirror the conversions themselves: product lines a sales
// order takes (or has taken) never double-report as invoice charges.

vi.mock('@shared/services/numberingService', () => ({ SharedNumberingService: { getNextNumber: vi.fn() } }));
vi.mock('../models/contract', () => ({ default: {} }));
vi.mock('../models/quote', () => ({ default: {} }));
vi.mock('../models/quoteActivity', () => ({ default: {} }));

const db = vi.hoisted(() => ({
  salesOrder: undefined as Record<string, unknown> | undefined,
  salesOrderLines: [] as Record<string, unknown>[],
  productServiceIds: [] as string[],
}));

function makeChain(table: string) {
  const chain: any = {};
  for (const method of ['where', 'whereIn', 'orderBy', 'select']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.first = vi.fn(async () => (table === 'sales_orders' ? db.salesOrder : undefined));
  chain.then = (resolve: (rows: unknown[]) => unknown) => {
    if (table === 'sales_order_lines') return Promise.resolve(db.salesOrderLines).then(resolve);
    if (table === 'service_catalog') {
      return Promise.resolve(db.productServiceIds.map((service_id) => ({ service_id }))).then(resolve);
    }
    return Promise.resolve([]).then(resolve);
  };
  return chain;
}

const fakeKnex = ((table: string) => makeChain(table)) as any;

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, _tenant: string) => ({
    table: (name: string) => makeChain(name),
    tenantJoin: (query: unknown) => query,
  }),
}));

import { buildQuoteConversionPreview } from './quoteConversionService';

const TENANT = 'tenant-1';

function item(overrides: Partial<IQuoteItem>): IQuoteItem {
  return {
    quote_item_id: 'item-x',
    quote_id: 'quote-1',
    tenant: TENANT,
    description: 'Item',
    quantity: 1,
    unit_price: 1000,
    total_price: 1000,
    is_optional: false,
    is_selected: true,
    is_recurring: false,
    is_discount: false,
    ...overrides,
  } as IQuoteItem;
}

function quoteWith(items: IQuoteItem[]): IQuote {
  return { quote_id: 'quote-1', tenant: TENANT, quote_items: items } as IQuote;
}

const productItem = item({ quote_item_id: 'prod-1', service_id: 'svc-prod', service_item_kind: 'product' } as any);
const serviceItem = item({ quote_item_id: 'svc-1', service_id: 'svc-labor', description: 'Onboarding labor' });

describe('buildQuoteConversionPreview', () => {
  beforeEach(() => {
    db.salesOrder = undefined;
    db.salesOrderLines = [{ so_line_id: 'prod-1', service_id: 'svc-prod', quantity_ordered: 1, unit_price: 1000 }];
    db.productServiceIds = ['svc-prod'];
  });

  it('without a sales order: products invoice directly and also list as future sales-order lines', async () => {
    const preview = await buildQuoteConversionPreview(quoteWith([productItem, serviceItem]), fakeKnex, TENANT);

    expect(preview.invoice_items.map((i) => i.quote_item_id).sort()).toEqual(['prod-1', 'svc-1']);
    expect(preview.sales_order_items.map((i) => i.quote_item_id)).toEqual(['prod-1']);
    expect(preview.existing_sales_order).toBeNull();
  });

  it('with a sales order: its product lines leave the invoice bucket and report as sales-order lines', async () => {
    db.salesOrder = { so_id: 'so-1', so_number: 'SO00001' };

    const preview = await buildQuoteConversionPreview(quoteWith([productItem, serviceItem]), fakeKnex, TENANT);

    expect(preview.invoice_items.map((i) => i.quote_item_id)).toEqual(['svc-1']);
    expect(preview.sales_order_items.map((i) => i.quote_item_id)).toEqual(['prod-1']);
    expect(preview.sales_order_items[0]!.target).toBe('sales_order');
    expect(preview.existing_sales_order).toEqual({ so_id: 'so-1', so_number: 'SO00001' });
  });

  it('with a sales order and a products-only quote: nothing is left to invoice', async () => {
    db.salesOrder = { so_id: 'so-1', so_number: 'SO00001' };

    const preview = await buildQuoteConversionPreview(quoteWith([productItem]), fakeKnex, TENANT);

    expect(preview.invoice_items).toEqual([]);
    expect(preview.available_actions).not.toContain('invoice');
    expect(preview.sales_order_items).toHaveLength(1);
  });

  it('keeps invoice conversion available and splits product prices to conserve indivisible cents', async () => {
    const product = item({ ...productItem, quantity: 3, total_price: 3000 });
    const discount = item({ quote_item_id: 'discount', is_discount: true, discount_type: 'fixed', unit_price: 100 });
    const preview = await buildQuoteConversionPreview(quoteWith([product, discount]), fakeKnex, TENANT);

    expect(preview.available_actions).toContain('invoice');
    expect(preview.invoice_error).toBeNull();
    expect(preview.invoice_items.reduce((sum, row) => sum + row.total_price, 0)).toBe(2900);
    expect(preview.sales_order_items.map((row) => [row.quantity, row.unit_price])).toEqual([[1, 966], [2, 967]]);
    expect(new Set(preview.sales_order_items.map((row) => row.quote_item_id)).size).toBe(2);
  });

  it('shows actual legacy sales-order prices and blocks only the invoice when discounts are missing', async () => {
    db.salesOrder = { so_id: 'so-1', so_number: 'SO00001' };
    db.salesOrderLines = [{ so_line_id: 'line-1', service_id: 'svc-prod', quantity_ordered: 1, unit_price: 1000 }];
    const discount = item({ quote_item_id: 'discount', is_discount: true, discount_type: 'fixed', unit_price: 400 });
    const recurring = item({ quote_item_id: 'rec', service_id: 'rec-service', is_recurring: true, unit_price: 0, total_price: 0 });
    const quote = quoteWith([productItem, serviceItem, discount, recurring]);
    const preview = await buildQuoteConversionPreview(quote, fakeKnex, TENANT);

    expect(preview.sales_order_items[0].total_price).toBe(1000);
    expect(preview.invoice_error).toContain('SO00001');
    expect(preview.available_actions).toEqual(['contract']);

    db.salesOrderLines[0].unit_price = 800;
    const reconciled = await buildQuoteConversionPreview(quote, fakeKnex, TENANT);
    expect(reconciled.invoice_error).toBeNull();
    expect(reconciled.available_actions).toContain('invoice');
    expect(reconciled.sales_order_items[0].total_price).toBe(800);
  });
});
