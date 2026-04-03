import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQuote } from '@alga-psa/types';

const fetchTenantPartyMock = vi.fn();

vi.mock('./tenantPartyAdapter', () => ({
  fetchTenantParty: (...args: unknown[]) => fetchTenantPartyMock(...args),
}));

import { mapLoadedQuoteToViewModel } from './quoteAdapters';

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
