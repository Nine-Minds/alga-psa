import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IQuote, IQuoteItem } from '@alga-psa/types';

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

const baseQuoteItem = (overrides: Record<string, unknown> = {}): IQuoteItem => ({
  tenant: 'tenant-1',
  quote_id: 'quote-1',
  description: 'Item',
  quantity: 1,
  unit_price: 0,
  total_price: 0,
  tax_amount: 0,
  net_amount: 0,
  display_order: 1,
  is_optional: false,
  is_selected: true,
  is_recurring: false,
  billing_frequency: null,
  ...overrides,
} as IQuoteItem);

describe('quoteAdapters discount group allocation', () => {
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

  const buildDiscountBaselineQuote = (discountOverrides: Record<string, unknown> = {}) => {
    const twoMonthlyServices = [
      baseQuoteItem({
        quote_item_id: 'monthly-a',
        description: 'Managed Support A',
        unit_price: 2500,
        total_price: 2500,
        is_recurring: true,
        billing_frequency: 'monthly',
        service_id: 'svc-a',
        service_name: 'Managed Support A',
        service_item_kind: 'service',
      }),
      baseQuoteItem({
        quote_item_id: 'monthly-b',
        description: 'Managed Support B',
        unit_price: 3500,
        total_price: 3500,
        is_recurring: true,
        billing_frequency: 'monthly',
        service_id: 'svc-b',
        service_name: 'Managed Support B',
        service_item_kind: 'service',
      }),
    ];

    const onetimeBases = [37353, 210863, 5581, 45000].map((cents, index) =>
      baseQuoteItem({
        quote_item_id: `onetime-${index}`,
        description: `One-time charge ${index}`,
        unit_price: cents,
        total_price: cents,
        display_order: 10 + index,
      })
    );

    const discounts = [
      baseQuoteItem({
        quote_item_id: 'disc-a',
        description: 'Discount A',
        unit_price: 500,
        total_price: 500,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_service_id: 'svc-a',
        display_order: 20,
        is_recurring: false,
        billing_frequency: null,
        ...discountOverrides,
      }),
      baseQuoteItem({
        quote_item_id: 'disc-b',
        description: 'Discount B',
        unit_price: 500,
        total_price: 500,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_service_id: 'svc-b',
        display_order: 21,
        is_recurring: false,
        billing_frequency: null,
      }),
    ];

    const quoteItems = [...twoMonthlyServices, ...discounts, ...onetimeBases];

    return buildQuote({
      subtotal: 304797,
      discount_total: 1000,
      tax: 0,
      total_amount: 303797,
      quote_items: quoteItems,
    });
  };

  it('T007 reproduces $25 + $35 less $5 + $5 as $50 recurring with one-time unchanged (legacy false/null cadence)', async () => {
    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', buildDiscountBaselineQuote());

    // Recurring group carries the two monthly services plus each discount as a
    // reduction: $60 base - $5 - $5 = $50.
    expect(viewModel.recurring_items?.map((item) => item.quote_item_id)).toEqual([
      'monthly-a',
      'monthly-b',
      'disc-a',
      'disc-b',
    ]);
    expect(viewModel.recurring_items?.filter((item) => item.is_discount).map((item) => item.total_price)).toEqual([
      -500,
      -500,
    ]);
    expect(viewModel.recurring_subtotal).toBe(5000);
    expect(viewModel.recurring_total).toBe(5000);

    // One-time group only holds the one-time base charges.
    expect(viewModel.onetime_items?.map((item) => item.quote_item_id)).toEqual([
      'onetime-0',
      'onetime-1',
      'onetime-2',
      'onetime-3',
    ]);
    expect(viewModel.onetime_subtotal).toBe(298797);
    expect(viewModel.onetime_total).toBe(298797);

    // Overall quote totals remain on the persisted subtotal - discount contract.
    expect(viewModel.subtotal).toBe(304797);
    expect(viewModel.discount_total).toBe(1000);
    expect(viewModel.tax).toBe(0);
    expect(viewModel.total_amount).toBe(303797);

    // The general line-item collection keeps discount rows positive.
    expect(viewModel.line_items.filter((item) => item.is_discount).map((item) => item.total_price)).toEqual([500, 500]);
  });

  it('T008 derives cadence membership from target relationships regardless of persisted discount cadence', async () => {
    // Persisted discount cadence fields contradict the recurring targets.
    const viewModel = await mapLoadedQuoteToViewModel(
      fakeKnex,
      'tenant-1',
      buildDiscountBaselineQuote({ is_recurring: true, billing_frequency: 'monthly' })
    );

    expect(viewModel.recurring_subtotal).toBe(5000);
    expect(viewModel.onetime_subtotal).toBe(298797);
    expect(viewModel.discount_total).toBe(1000);
  });

  it('T008 splits a whole-quote discount across recurring and one-time bases proportionally', async () => {
    const quote = buildQuote({
      subtotal: 16000,
      discount_total: 1000,
      tax: 0,
      total_amount: 15000,
      quote_items: [
        ...(() => {
          const base = [
            baseQuoteItem({
              quote_item_id: 'monthly-a',
              description: 'Managed Support',
              unit_price: 2500,
              total_price: 2500,
              is_recurring: true,
              billing_frequency: 'monthly',
              service_id: 'svc-a',
              service_item_kind: 'service',
            }),
            baseQuoteItem({
              quote_item_id: 'monthly-b',
              description: 'Managed Support B',
              unit_price: 3500,
              total_price: 3500,
              is_recurring: true,
              billing_frequency: 'monthly',
              service_id: 'svc-b',
              service_item_kind: 'service',
            }),
            baseQuoteItem({
              quote_item_id: 'onetime-0',
              description: 'Onboarding',
              unit_price: 10000,
              total_price: 10000,
            }),
          ];
          const discount = baseQuoteItem({
            quote_item_id: 'disc-whole',
            description: 'Whole quote discount',
            unit_price: 1000,
            total_price: 1000,
            is_discount: true,
            discount_type: 'fixed',
            is_recurring: false,
            billing_frequency: null,
          });
          return [...base, discount];
        })(),
      ],
    });

    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);

    // $10 across a $160 base: $60 recurring / $100 onetime -> 375 / 625 exact.
    const recurringDiscount = viewModel.recurring_items?.find((item) => item.is_discount);
    const onetimeDiscount = viewModel.onetime_items?.find((item) => item.is_discount);
    expect(recurringDiscount?.total_price).toBe(-375);
    expect(onetimeDiscount?.total_price).toBe(-625);
    expect(viewModel.recurring_subtotal).toBe(6000 - 375);
    expect(viewModel.onetime_subtotal).toBe(10000 - 625);
    // Each allocated cent is counted exactly once across the two cadence groups.
    expect(viewModel.recurring_subtotal! + viewModel.onetime_subtotal!).toBe(16000 - 1000);
  });

  it('T008 excludes optional unselected base items from bases and group summaries', async () => {
    const quote = buildQuote({
      subtotal: 6000,
      discount_total: 500,
      tax: 0,
      total_amount: 5500,
      quote_items: [
        baseQuoteItem({
          quote_item_id: 'monthly-a',
          description: 'Managed Support',
          unit_price: 2500,
          total_price: 2500,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-a',
          service_item_kind: 'service',
        }),
        baseQuoteItem({
          quote_item_id: 'monthly-b',
          description: 'Managed Support B',
          unit_price: 3500,
          total_price: 3500,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-b',
          service_item_kind: 'service',
        }),
        // Optional but unselected — contributes no base and receives no share.
        baseQuoteItem({
          quote_item_id: 'monthly-opt',
          description: 'Optional service',
          unit_price: 4000,
          total_price: 4000,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-opt',
          service_item_kind: 'service',
          is_optional: true,
          is_selected: false,
          display_order: 3,
        }),
        baseQuoteItem({
          quote_item_id: 'disc-whole',
          description: 'Whole quote discount',
          unit_price: 500,
          total_price: 500,
          is_discount: true,
          discount_type: 'fixed',
          is_recurring: false,
          billing_frequency: null,
          display_order: 4,
        }),
      ],
    });

    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);

    expect(viewModel.recurring_subtotal).toBe(6000 - 500);
  });

  it('T008 caps a fixed discount at its eligible base so group totals cannot go negative', async () => {
    const quote = buildQuote({
      subtotal: 2500,
      discount_total: 2500,
      tax: 0,
      total_amount: 0,
      quote_items: [
        baseQuoteItem({
          quote_item_id: 'monthly-a',
          description: 'Managed Support',
          unit_price: 2500,
          total_price: 2500,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-a',
          service_item_kind: 'service',
        }),
        baseQuoteItem({
          quote_item_id: 'disc-a',
          description: 'Oversized discount',
          unit_price: 4000,
          total_price: 4000,
          is_discount: true,
          discount_type: 'fixed',
          applies_to_service_id: 'svc-a',
          is_recurring: false,
          billing_frequency: null,
          display_order: 2,
        }),
      ],
    });

    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);

    expect(viewModel.recurring_subtotal).toBe(0);
    const discountRow = viewModel.recurring_items?.find((item) => item.is_discount);
    expect(discountRow?.total_price).toBe(-2500);
  });

  it('T008 resolves a percentage service discount from target bases with existing rounding', async () => {
    const quote = buildQuote({
      subtotal: 6000,
      discount_total: 600,
      tax: 0,
      total_amount: 5400,
      quote_items: [
        baseQuoteItem({
          quote_item_id: 'monthly-a',
          description: 'Managed Support',
          unit_price: 2500,
          total_price: 2500,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-a',
          service_item_kind: 'service',
        }),
        baseQuoteItem({
          quote_item_id: 'monthly-b',
          description: 'Managed Support B',
          unit_price: 3500,
          total_price: 3500,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: 'svc-a',
          service_item_kind: 'service',
        }),
        baseQuoteItem({
          quote_item_id: 'disc-a',
          description: '10% off service',
          unit_price: 0,
          total_price: 600,
          is_discount: true,
          discount_type: 'percentage',
          discount_percentage: 10,
          applies_to_service_id: 'svc-a',
          is_recurring: false,
          billing_frequency: null,
          display_order: 3,
        }),
      ],
    });

    const viewModel = await mapLoadedQuoteToViewModel(fakeKnex, 'tenant-1', quote);

    expect(viewModel.recurring_subtotal).toBe(6000 - 600);
    const discountRows = viewModel.recurring_items?.filter((item) => item.is_discount) ?? [];
    expect(discountRows.length).toBe(1);
    expect(discountRows[0]?.total_price).toBe(-600);
  });
});
