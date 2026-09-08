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

  it('groups a discount targeting a recurring service with the monthly items it reduces', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          {
            tenant: 'tenant-1',
            quote_item_id: 'monthly-a',
            quote_id: 'quote-1',
            service_id: 'service-a',
            description: 'Managed Support',
            quantity: 1,
            unit_price: 3000,
            total_price: 3000,
            tax_amount: 0,
            net_amount: 3000,
            display_order: 1,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'monthly-b',
            quote_id: 'quote-1',
            service_id: 'service-b',
            description: 'Backup Monitoring',
            quantity: 1,
            unit_price: 3000,
            total_price: 3000,
            tax_amount: 0,
            net_amount: 3000,
            display_order: 2,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'onetime-setup',
            quote_id: 'quote-1',
            description: 'Onboarding',
            quantity: 1,
            unit_price: 20000,
            total_price: 20000,
            tax_amount: 0,
            net_amount: 20000,
            display_order: 3,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            service_item_kind: 'service',
          },
          {
            // Fixed discount on a monthly item — persisted positive, presented negative.
            tenant: 'tenant-1',
            quote_item_id: 'discount-item',
            quote_id: 'quote-1',
            description: 'Discount',
            quantity: 1,
            unit_price: 500,
            total_price: 500,
            tax_amount: 0,
            net_amount: 500,
            display_order: 4,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            is_discount: true,
            discount_type: 'fixed',
            applies_to_item_id: 'monthly-a',
          },
          {
            // Percentage discount scoped to a monthly service.
            tenant: 'tenant-1',
            quote_item_id: 'discount-service',
            quote_id: 'quote-1',
            description: 'Discount (16%)',
            quantity: 1,
            unit_price: 0,
            total_price: 500,
            tax_amount: 0,
            net_amount: 500,
            display_order: 5,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            is_discount: true,
            discount_type: 'percentage',
            discount_percentage: 16,
            applies_to_service_id: 'service-b',
          },
        ],
      })
    );

    expect(viewModel.recurring_items?.map((item) => item.quote_item_id)).toEqual([
      'monthly-a',
      'monthly-b',
      'discount-item',
      'discount-service',
    ]);
    expect(viewModel.onetime_items?.map((item) => item.quote_item_id)).toEqual(['onetime-setup']);

    // $30 + $30 − $5 − $5 = $50 monthly; the one-time group is untouched.
    expect(viewModel.recurring_subtotal).toBe(5000);
    expect(viewModel.recurring_total).toBe(5000);
    expect(viewModel.onetime_subtotal).toBe(20000);
    expect(viewModel.onetime_total).toBe(20000);
    expect(viewModel.service_subtotal).toBe(25000);

    const discountLine = viewModel.line_items.find((item) => item.quote_item_id === 'discount-item');
    expect(discountLine?.total_price).toBe(-500);
    expect(discountLine?.unit_price).toBe(-500);
    expect(discountLine?.net_amount).toBe(-500);
  });

  it('keeps a discount targeting a one-time item in the one-time group', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          {
            tenant: 'tenant-1',
            quote_item_id: 'monthly-a',
            quote_id: 'quote-1',
            description: 'Managed Support',
            quantity: 1,
            unit_price: 3000,
            total_price: 3000,
            tax_amount: 0,
            net_amount: 3000,
            display_order: 1,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'onetime-hardware',
            quote_id: 'quote-1',
            description: 'Firewall Appliance',
            quantity: 1,
            unit_price: 25000,
            total_price: 25000,
            tax_amount: 0,
            net_amount: 25000,
            display_order: 2,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            service_item_kind: 'product',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'discount-hardware',
            quote_id: 'quote-1',
            description: 'Discount',
            quantity: 1,
            unit_price: 2500,
            total_price: 2500,
            tax_amount: 0,
            net_amount: 2500,
            display_order: 3,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            is_discount: true,
            discount_type: 'fixed',
            applies_to_item_id: 'onetime-hardware',
          },
        ],
      })
    );

    expect(viewModel.recurring_items?.map((item) => item.quote_item_id)).toEqual(['monthly-a']);
    expect(viewModel.onetime_items?.map((item) => item.quote_item_id)).toEqual([
      'onetime-hardware',
      'discount-hardware',
    ]);
    expect(viewModel.recurring_subtotal).toBe(3000);
    expect(viewModel.onetime_subtotal).toBe(22500);
    expect(viewModel.product_subtotal).toBe(22500);
  });

  it('leaves quote-wide discounts in their own group and subtracts them there', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildQuote({
        quote_items: [
          {
            tenant: 'tenant-1',
            quote_item_id: 'monthly-a',
            quote_id: 'quote-1',
            description: 'Managed Support',
            quantity: 1,
            unit_price: 3000,
            total_price: 3000,
            tax_amount: 0,
            net_amount: 3000,
            display_order: 1,
            is_optional: false,
            is_selected: true,
            is_recurring: true,
            billing_frequency: 'monthly',
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'onetime-setup',
            quote_id: 'quote-1',
            description: 'Onboarding',
            quantity: 1,
            unit_price: 20000,
            total_price: 20000,
            tax_amount: 0,
            net_amount: 20000,
            display_order: 2,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            service_item_kind: 'service',
          },
          {
            tenant: 'tenant-1',
            quote_item_id: 'discount-quote-wide',
            quote_id: 'quote-1',
            description: 'Multi-year Commitment Discount (10%)',
            quantity: 1,
            unit_price: 0,
            total_price: 2300,
            tax_amount: 0,
            net_amount: 2300,
            display_order: 3,
            is_optional: false,
            is_selected: true,
            is_recurring: false,
            is_discount: true,
            discount_type: 'percentage',
            discount_percentage: 10,
          },
        ],
      })
    );

    expect(viewModel.recurring_items?.map((item) => item.quote_item_id)).toEqual(['monthly-a']);
    expect(viewModel.onetime_items?.map((item) => item.quote_item_id)).toEqual([
      'onetime-setup',
      'discount-quote-wide',
    ]);
    expect(viewModel.recurring_subtotal).toBe(3000);
    expect(viewModel.onetime_subtotal).toBe(17700);
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
