import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQuote } from '@alga-psa/types';

const fetchTenantPartyMock = vi.fn();

vi.mock('./tenantPartyAdapter', () => ({
  fetchTenantParty: (...args: unknown[]) => fetchTenantPartyMock(...args),
}));

import { mapLoadedQuoteToViewModel, toDateOnlyString, toIsoDateString } from './quoteAdapters';

const fakeKnex = {
  schema: {
    hasTable: vi.fn(),
  },
} as any;

const buildQuote = (overrides: Partial<IQuote> = {}): IQuote => ({
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  quote_number: 'QT-001',
  title: 'Managed Services Proposal',
  version: 1,
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  currency_code: 'USD',
  is_template: false,
  client_id: null,
  contact_id: null,
  accepted_by: null,
  quote_items: [],
  ...overrides,
});

describe('quoteAdapters', () => {
  beforeEach(() => {
    fetchTenantPartyMock.mockReset();
    fetchTenantPartyMock.mockResolvedValue({
      name: 'Northwind MSP',
      address: '400 SW Main',
      email: 'billing@example.com',
      phone: '555-0100',
      logo_url: null,
    });
  });

  it('normalizes Date values and preserves trimmed ISO date strings', () => {
    expect(toIsoDateString(new Date('2026-07-17T12:30:00.000Z'))).toBe('2026-07-17T12:30:00.000Z');
    expect(toIsoDateString(' 2026-07-31T00:00:00.000Z ')).toBe('2026-07-31T00:00:00.000Z');
    expect(toIsoDateString(null)).toBeNull();
    expect(toIsoDateString(new Date('invalid'))).toBeNull();
    expect(toIsoDateString('   ')).toBeNull();
  });

  it('normalizes quote calendar dates without retaining a timezone-bearing time', () => {
    expect(toDateOnlyString(new Date('2026-07-13T00:00:00.000Z'))).toBe('2026-07-13');
    expect(toDateOnlyString(' 2026-08-12T00:00:00.000Z ')).toBe('2026-08-12');
    expect(toDateOnlyString('2026-08-12')).toBe('2026-08-12');
    expect(toDateOnlyString(null)).toBeNull();
  });

  it('normalizes quote calendar dates separately from acceptance timestamps', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_date: new Date('2026-07-17T12:30:00.000Z') as unknown as string,
        valid_until: new Date('2026-08-17T12:30:00.000Z') as unknown as string,
        accepted_at: new Date('2026-07-18T12:30:00.000Z') as unknown as string,
      })
    );

    expect(viewModel.quote_date).toBe('2026-07-17');
    expect(viewModel.valid_until).toBe('2026-08-17');
    expect(viewModel.accepted_at).toBe('2026-07-18T12:30:00.000Z');
  });

  it('builds recurring, one-time, service, and product filtered collections from quote line items', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          {
            tenant: 'tenant-1',
            quote_item_id: 'item-recurring-service',
            quote_id: 'quote-1',
            description: 'Managed Support',
            quantity: 1,
            unit_price: 10000,
            total_price: 10000,
            tax_amount: 800,
            net_amount: 10800,
            display_order: 1,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'item-onetime-product',
            quote_id: 'quote-1',
            description: 'Firewall Appliance',
            quantity: 1,
            unit_price: 25000,
            total_price: 25000,
            tax_amount: 2000,
            net_amount: 27000,
            display_order: 2,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            billing_frequency: null,
            service_item_kind: 'product',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'item-recurring-product',
            quote_id: 'quote-1',
            description: 'Endpoint Licenses',
            quantity: 25,
            unit_price: 400,
            total_price: 10000,
            tax_amount: 800,
            net_amount: 10800,
            display_order: 3,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'product',
          },
        ],
      })
    );

    expect(viewModel.recurring_items?.map((item) => item.quote_item_id)).toEqual([
      'item-recurring-service',
      'item-recurring-product',
    ]);
    expect(viewModel.onetime_items?.map((item) => item.quote_item_id)).toEqual(['item-onetime-product']);
    expect(viewModel.service_items?.map((item) => item.quote_item_id)).toEqual(['item-recurring-service']);
    expect(viewModel.product_items?.map((item) => item.quote_item_id)).toEqual([
      'item-onetime-product',
      'item-recurring-product',
    ]);
    expect(viewModel.line_items[0]?.service_item_kind).toBe('service');
  });

  it('computes recurring, one-time, service, and product subtotal/tax/total groups from filtered items', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          {
            tenant: 'tenant-1',
            quote_item_id: 'service-recurring',
            quote_id: 'quote-1',
            description: 'Managed Support',
            quantity: 1,
            unit_price: 10000,
            total_price: 10000,
            tax_amount: 800,
            net_amount: 10800,
            display_order: 1,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'service-onetime',
            quote_id: 'quote-1',
            description: 'Onboarding',
            quantity: 1,
            unit_price: 5000,
            total_price: 5000,
            tax_amount: 400,
            net_amount: 5400,
            display_order: 2,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            billing_frequency: null,
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'product-onetime',
            quote_id: 'quote-1',
            description: 'Switch Hardware',
            quantity: 1,
            unit_price: 12000,
            total_price: 12000,
            tax_amount: 960,
            net_amount: 12960,
            display_order: 3,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            billing_frequency: null,
            service_item_kind: 'product',
          },
        ],
      })
    );

    expect(viewModel.recurring_subtotal).toBe(10000);
    expect(viewModel.recurring_tax).toBe(800);
    expect(viewModel.recurring_total).toBe(10800);

    expect(viewModel.onetime_subtotal).toBe(17000);
    expect(viewModel.onetime_tax).toBe(1360);
    expect(viewModel.onetime_total).toBe(18360);

    expect(viewModel.service_subtotal).toBe(15000);
    expect(viewModel.service_tax).toBe(1200);
    expect(viewModel.service_total).toBe(16200);

    expect(viewModel.product_subtotal).toBe(12000);
    expect(viewModel.product_tax).toBe(960);
    expect(viewModel.product_total).toBe(12960);
  });

  it('returns empty filtered collections and zero aggregates when no items match a grouping', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [],
      })
    );

    expect(viewModel.recurring_items).toEqual([]);
    expect(viewModel.onetime_items).toEqual([]);
    expect(viewModel.service_items).toEqual([]);
    expect(viewModel.product_items).toEqual([]);
    expect(viewModel.recurring_subtotal).toBe(0);
    expect(viewModel.recurring_tax).toBe(0);
    expect(viewModel.recurring_total).toBe(0);
    expect(viewModel.onetime_subtotal).toBe(0);
    expect(viewModel.onetime_tax).toBe(0);
    expect(viewModel.onetime_total).toBe(0);
    expect(viewModel.service_subtotal).toBe(0);
    expect(viewModel.service_tax).toBe(0);
    expect(viewModel.service_total).toBe(0);
    expect(viewModel.product_subtotal).toBe(0);
    expect(viewModel.product_tax).toBe(0);
    expect(viewModel.product_total).toBe(0);
  });
});

describe('quoteAdapters catalog-description mapping', () => {
  const catalogItem = (overrides: Record<string, unknown> = {}): never =>
    ({
      tenant: 'tenant-1',
      quote_item_id: 'item-1',
      quote_id: 'quote-1',
      description: 'Managed Firewall Service',
      catalog_description: 'Central management, rule review, and firmware patching for the managed firewall fleet.',
      service_name: 'Managed Firewall Service',
      service_sku: null,
      service_item_kind: 'service',
      quantity: 1,
      unit_price: 25000,
      total_price: 25000,
      tax_amount: 2000,
      net_amount: 27000,
      display_order: 1,
      is_optional: false,
      is_selected: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      ...overrides,
    }) as never;

  it('maps catalog_description onto flat and grouped line-item collections with null handling', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          catalogItem(),
          catalogItem({
            quote_item_id: 'item-2',
            is_recurring: false,
            billing_frequency: null,
            service_item_kind: 'product',
            service_name: 'Firewall Appliance',
            description: 'Firewall Appliance',
            catalog_description: null,
          }),
          catalogItem({
            quote_item_id: 'item-3',
            is_discount: true,
            service_name: null,
            service_sku: null,
            service_item_kind: null,
            catalog_description: null,
            description: 'Discount (10%)',
            quantity: 1,
            unit_price: -2500,
            total_price: -2500,
            tax_amount: 0,
            net_amount: -2500,
          }),
        ],
      })
    );

    const flat = viewModel.line_items;
    expect(flat[0]?.catalog_description).toBe(
      'Central management, rule review, and firmware patching for the managed firewall fleet.',
    );
    expect(flat[1]?.catalog_description).toBeNull();
    expect(flat[2]?.catalog_description).toBeNull();

    expect(viewModel.recurring_items?.find((item) => item.quote_item_id === 'item-1')?.catalog_description)
      .toBe('Central management, rule review, and firmware patching for the managed firewall fleet.');
    expect(viewModel.onetime_items?.find((item) => item.quote_item_id === 'item-2')?.catalog_description)
      .toBeNull();
  });
});
