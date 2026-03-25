import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Stub knex/tenant layer so the module can be imported ────────────
const knexStub: any = {};
const tenantStub = 'test-tenant';
const quoteId = 'q-001';

// Helper: build a mock knex that returns the supplied quote + items rows
// and captures the update calls for assertions.
function buildMockKnex(opts: {
  quote: Record<string, any> | undefined;
  items: Record<string, any>[];
  client?: Record<string, any> | null;
}) {
  const updatedQuoteItems = new Map<string, Record<string, any>>();
  let updatedQuote: Record<string, any> | null = null;

  const knex: any = (table: string) => {
    const chain: any = {};
    chain.where = vi.fn(() => chain);
    chain.whereNull = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.first = vi.fn(async () => {
      if (table === 'quotes') return opts.quote;
      if (table === 'clients') return opts.client ?? null;
      return null;
    });
    chain.update = vi.fn(async (data: Record<string, any>) => {
      if (table === 'quote_items') {
        // The where call receives {tenant, quote_item_id}
        const whereArg = chain.where.mock.calls[0]?.[0];
        if (whereArg?.quote_item_id) {
          updatedQuoteItems.set(whereArg.quote_item_id, data);
        }
      }
      if (table === 'quotes') {
        updatedQuote = data;
      }
    });

    // For the items query (returns array, no .first())
    chain.then = undefined;
    (chain as any)[Symbol.iterator] = undefined;

    // Make it thenable so await works for array results
    const resolve = async () => {
      if (table === 'quote_items' && !chain.update.mock.calls.length) {
        return opts.items;
      }
      return chain;
    };
    chain.then = (onFulfill: any, onReject?: any) => resolve().then(onFulfill, onReject);

    return chain;
  };
  knex.fn = { now: () => 'NOW()' };

  return { knex, getUpdatedQuote: () => updatedQuote, getUpdatedItems: () => updatedQuoteItems };
}

// ── Mock TaxService ─────────────────────────────────────────────────
const calculateTaxMock = vi.fn();
vi.mock('../../src/services/taxService', () => ({
  TaxService: vi.fn(() => ({ calculateTax: (...args: any[]) => calculateTaxMock(...args) })),
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: async (_t: string, fn: () => Promise<any>) => fn(),
}));

// ── Import under test ────────────────────────────────────────────────
import { recalculateQuoteFinancials } from '../../src/services/quoteCalculationService';

// ── Tests ────────────────────────────────────────────────────────────
describe('quoteCalculationService – recalculateQuoteFinancials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calculateTaxMock.mockResolvedValue({ taxAmount: 0, taxRate: 0 });
  });

  it('T200: returns early when quote is not found', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({ quote: undefined, items: [] });
    await recalculateQuoteFinancials(knex, tenantStub, quoteId);
    expect(getUpdatedQuote()).toBeNull();
  });

  it('T201: calculates subtotal from included base items', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 2, unit_price: 5000, is_discount: false, is_optional: false },
        { quote_item_id: 'i2', quantity: 1, unit_price: 3000, is_discount: false, is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(13000); // 2*5000 + 1*3000
    expect(q.discount_total).toBe(0);
    expect(q.tax).toBe(0);
    expect(q.total_amount).toBe(13000);
  });

  it('T202: excludes optional items that are not selected', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false },
        { quote_item_id: 'i2', quantity: 1, unit_price: 5000, is_discount: false, is_optional: true, is_selected: false },
        { quote_item_id: 'i3', quantity: 1, unit_price: 2000, is_discount: false, is_optional: true, is_selected: true },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(12000); // i1 (10000) + i3 (2000), i2 excluded
    expect(q.total_amount).toBe(12000);
  });

  it('T203: applies a fixed discount across the whole quote', async () => {
    const { knex, getUpdatedQuote, getUpdatedItems } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false },
        { quote_item_id: 'd1', quantity: 1, unit_price: 1500, is_discount: true, discount_type: 'fixed', is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(10000);
    expect(q.discount_total).toBe(1500);
    expect(q.total_amount).toBe(8500); // 10000 - 1500
  });

  it('T204: applies a percentage discount scoped to the whole subtotal', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false },
        { quote_item_id: 'i2', quantity: 1, unit_price: 5000, is_discount: false, is_optional: false },
        { quote_item_id: 'd1', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10, is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(15000);
    expect(q.discount_total).toBe(1500); // 10% of 15000
    expect(q.total_amount).toBe(13500);
  });

  it('T205: applies a percentage discount scoped to a specific item', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 2, unit_price: 5000, is_discount: false, is_optional: false },
        { quote_item_id: 'i2', quantity: 1, unit_price: 3000, is_discount: false, is_optional: false },
        { quote_item_id: 'd1', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 20, applies_to_item_id: 'i1', is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(13000); // 2*5000 + 3000
    expect(q.discount_total).toBe(2000); // 20% of 10000 (item i1 total)
    expect(q.total_amount).toBe(11000);
  });

  it('T206: applies a percentage discount scoped to a service', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 8000, is_discount: false, is_optional: false, service_id: 'svc-a' },
        { quote_item_id: 'i2', quantity: 1, unit_price: 4000, is_discount: false, is_optional: false, service_id: 'svc-a' },
        { quote_item_id: 'i3', quantity: 1, unit_price: 6000, is_discount: false, is_optional: false, service_id: 'svc-b' },
        { quote_item_id: 'd1', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 25, applies_to_service_id: 'svc-a', is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(18000); // 8000 + 4000 + 6000
    expect(q.discount_total).toBe(3000); // 25% of 12000 (svc-a total)
    expect(q.total_amount).toBe(15000);
  });

  it('T207: calculates tax for items with internal tax source', async () => {
    calculateTaxMock.mockResolvedValue({ taxAmount: 1000, taxRate: 10 });

    const { knex, getUpdatedQuote, getUpdatedItems } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: 'c-1', quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false, is_taxable: true },
      ],
      client: { region_code: 'US-CA' },
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(10000);
    expect(q.tax).toBe(1000);
    expect(q.total_amount).toBe(11000);
    expect(calculateTaxMock).toHaveBeenCalledOnce();

    const itemUpdate = getUpdatedItems().get('i1')!;
    expect(itemUpdate.tax_amount).toBe(1000);
    expect(itemUpdate.tax_rate).toBe(10);
  });

  it('T208: skips tax calculation when tax_source is external', async () => {
    const { knex, getUpdatedQuote, getUpdatedItems } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: 'c-1', quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'external' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false, is_taxable: true },
      ],
      client: { region_code: 'US-CA' },
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    expect(calculateTaxMock).not.toHaveBeenCalled();
    const q = getUpdatedQuote()!;
    expect(q.tax).toBe(0);
    expect(q.total_amount).toBe(10000);

    const itemUpdate = getUpdatedItems().get('i1')!;
    expect(itemUpdate.tax_amount).toBe(0);
    expect(itemUpdate.tax_rate).toBe(0);
  });

  it('T209: sets net_amount to 0 for unselected optional items', async () => {
    const { knex, getUpdatedItems } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 5000, is_discount: false, is_optional: true, is_selected: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const itemUpdate = getUpdatedItems().get('i1')!;
    expect(itemUpdate.net_amount).toBe(0);
  });

  it('T210: handles string quantities and prices via toNumber', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: '3', unit_price: '2000', is_discount: false, is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(6000);
    expect(q.total_amount).toBe(6000);
  });

  it('T211: defaults currency to USD and handles null quote_date', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: null, currency_code: null, tax_source: null },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 1000, is_discount: false, is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(1000);
    expect(q.total_amount).toBe(1000);
  });

  it('T212: multiple discounts stack correctly', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 20000, is_discount: false, is_optional: false },
        { quote_item_id: 'd1', quantity: 1, unit_price: 0, is_discount: true, discount_type: 'percentage', discount_percentage: 10, is_optional: false },
        { quote_item_id: 'd2', quantity: 1, unit_price: 500, is_discount: true, discount_type: 'fixed', is_optional: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(20000);
    expect(q.discount_total).toBe(2500); // 2000 (10%) + 500 (fixed)
    expect(q.total_amount).toBe(17500);
  });

  it('T213: unselected optional discount is excluded from totals', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [
        { quote_item_id: 'i1', quantity: 1, unit_price: 10000, is_discount: false, is_optional: false },
        { quote_item_id: 'd1', quantity: 1, unit_price: 1000, is_discount: true, discount_type: 'fixed', is_optional: true, is_selected: false },
      ],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.discount_total).toBe(0);
    expect(q.total_amount).toBe(10000);
  });

  it('T214: empty items list produces zero totals', async () => {
    const { knex, getUpdatedQuote } = buildMockKnex({
      quote: { quote_id: quoteId, client_id: null, quote_date: '2026-01-01', currency_code: 'USD', tax_source: 'internal' },
      items: [],
    });

    await recalculateQuoteFinancials(knex, tenantStub, quoteId);

    const q = getUpdatedQuote()!;
    expect(q.subtotal).toBe(0);
    expect(q.discount_total).toBe(0);
    expect(q.tax).toBe(0);
    expect(q.total_amount).toBe(0);
  });
});
