/**
 * alga-2026-0002902 — the workflow-runtime CRM DAL duplicates
 * packages/billing's QuoteItem persistence, so it needs the same rule: a quote
 * line inherits its tax treatment from the catalog service (no `tax_rate_id`
 * means non-taxable) instead of defaulting to taxable and picking up the
 * client's default rate, and the rate it stores is the exact percentage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '0b2b1b7c-4f36-4b2f-9a2b-3ec1d6a4f0aa';
const QUOTE_ID = 'f1d2a4c6-1f1a-4a3a-9c1c-2f3b4a5d6e70';
const SERVICE_ID = '8a7b6c5d-4e3f-4a2b-9c8d-7e6f5a4b3c21';
const CREATED_ITEM_ID = 'c0ffee00-1111-4222-8333-444455556666';

type HarnessOptions = {
  /** service_catalog row the line is created from; null for a custom line. */
  service?: Record<string, unknown> | null;
  /** tax_rates row the service's tax_rate_id resolves to (null = unknown id). */
  serviceTaxRate?: Record<string, unknown> | null;
  /** tax_rates rows active for the resolved region (the taxable path). */
  regionTaxRates?: Record<string, unknown>[];
  client?: Record<string, unknown> | null;
};

function buildHarness(opts: HarnessOptions) {
  const inserts: { table: string; payload: Record<string, any> }[] = [];
  const itemUpdates: Record<string, any>[] = [];
  const quoteUpdates: Record<string, any>[] = [];
  let createdRow: Record<string, any> | null = null;

  const knex: any = (table: string) => {
    const chain: any = {};
    const passthrough = [
      'where', 'andWhere', 'orWhere', 'whereNull', 'whereIn', 'join', 'leftJoin',
      'select', 'orderBy', 'max', 'groupBy', 'limit',
    ];
    for (const method of passthrough) {
      chain[method] = vi.fn(() => chain);
    }

    chain.first = vi.fn(async () => {
      switch (table) {
        case 'quotes':
          return {
            quote_id: QUOTE_ID,
            client_id: 'cl-1',
            quote_date: '2026-01-01',
            currency_code: 'USD',
            tax_source: 'internal',
          };
        case 'clients':
          return opts.client ?? { region_code: 'US-MN', is_tax_exempt: false };
        case 'service_catalog':
          return opts.service ?? null;
        case 'service_prices':
          return null;
        case 'tax_rates':
          // The service's tax_rate_id → region_code lookup in
          // deriveServiceTaxTreatment.
          return opts.serviceTaxRate ?? null;
        case 'quote_items':
          // Post-recalculation re-read of the created row.
          return { ...(createdRow ?? {}), ...(itemUpdates.at(-1) ?? {}) };
        default:
          return null;
      }
    });

    chain.insert = vi.fn((payload: Record<string, any>) => {
      inserts.push({ table, payload });
      createdRow = { quote_item_id: CREATED_ITEM_ID, ...payload };
      return { returning: async () => [createdRow] };
    });

    chain.update = vi.fn(async (payload: Record<string, any>) => {
      if (table === 'quote_items') itemUpdates.push(payload);
      if (table === 'quotes') quoteUpdates.push(payload);
      return 1;
    });

    const resolveArray = async () => {
      if (table === 'quote_items') return createdRow ? [createdRow] : [];
      if (table === 'tax_rates') return opts.regionTaxRates ?? [];
      return [];
    };
    chain.then = (onFulfilled: any, onRejected?: any) => resolveArray().then(onFulfilled, onRejected);

    return chain;
  };
  knex.fn = { now: () => 'NOW()' };

  return {
    knex,
    insertedItem: () => inserts.find((entry) => entry.table === 'quote_items')!.payload,
    lastItemUpdate: () => itemUpdates.at(-1)!,
    lastQuoteUpdate: () => quoteUpdates.at(-1)!,
  };
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    parentScopedTable: (table: string) => conn(table),
  }),
  withTransaction: async (conn: any, fn: any) => fn(conn),
}));

const { QuoteItem, createQuoteItemSchema } = await import('../crmWorkerDal');

const baseItem = {
  quote_id: QUOTE_ID,
  description: 'Managed service',
  quantity: 1,
  unit_price: 10000,
  display_order: 0,
};

const TAXABLE_SERVICE = {
  service_name: 'Taxed service',
  description: 'Catalog text',
  sku: null,
  default_rate: 10000,
  unit_of_measure: null,
  billing_method: 'fixed',
  item_kind: 'service',
  cost: null,
  cost_currency: null,
  tax_rate_id: 'a1b2c3d4-0000-4000-8000-000000000001',
};

const UNTAXED_SERVICE = { ...TAXABLE_SERVICE, service_name: 'Untaxed service', tax_rate_id: null };

describe('crmWorkerDal QuoteItem.create — service tax derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a line against a service with no tax rate as non-taxable', async () => {
    const h = buildHarness({ service: UNTAXED_SERVICE });

    await QuoteItem.create(h.knex, TENANT, { ...baseItem, service_id: SERVICE_ID } as any);

    expect(h.insertedItem().is_taxable).toBe(false);
    expect(h.insertedItem().tax_region ?? null).toBeNull();
    // ...and the recalculation charges it nothing, so the quote carries no tax.
    expect(h.lastItemUpdate().tax_amount).toBe(0);
    expect(h.lastItemUpdate().tax_rate).toBe(0);
    expect(h.lastQuoteUpdate().tax).toBe(0);
    expect(h.lastQuoteUpdate().total_amount).toBe(10000);
  });

  it('creates a line against a service with a tax rate as taxable in that region', async () => {
    const h = buildHarness({
      service: TAXABLE_SERVICE,
      serviceTaxRate: { region_code: 'US-MN' },
      regionTaxRates: [{ tax_percentage: 6.875 }],
    });

    await QuoteItem.create(h.knex, TENANT, { ...baseItem, service_id: SERVICE_ID } as any);

    expect(h.insertedItem().is_taxable).toBe(true);
    expect(h.insertedItem().tax_region).toBe('US-MN');
    expect(h.lastItemUpdate().tax_amount).toBe(688);
  });

  it('stores the exact percentage rather than a whole-percent rounding', async () => {
    const h = buildHarness({
      service: TAXABLE_SERVICE,
      serviceTaxRate: { region_code: 'US-MN' },
      regionTaxRates: [{ tax_percentage: 6.875 }],
    });

    await QuoteItem.create(h.knex, TENANT, { ...baseItem, service_id: SERVICE_ID } as any);

    expect(h.lastItemUpdate().tax_rate).toBe(6.875);
  });

  it('treats a tax_rate_id that resolves to no tenant rate as non-taxable', async () => {
    const h = buildHarness({ service: TAXABLE_SERVICE, serviceTaxRate: null });

    await QuoteItem.create(h.knex, TENANT, { ...baseItem, service_id: SERVICE_ID } as any);

    expect(h.insertedItem().is_taxable).toBe(false);
    expect(h.lastItemUpdate().tax_amount).toBe(0);
  });

  it('lets an explicit caller choice win over the service configuration', async () => {
    const taxedButExcluded = buildHarness({
      service: TAXABLE_SERVICE,
      serviceTaxRate: { region_code: 'US-MN' },
      regionTaxRates: [{ tax_percentage: 6.875 }],
    });
    await QuoteItem.create(
      taxedButExcluded.knex, TENANT,
      { ...baseItem, service_id: SERVICE_ID, is_taxable: false } as any,
    );
    expect(taxedButExcluded.insertedItem().is_taxable).toBe(false);

    const untaxedButIncluded = buildHarness({
      service: UNTAXED_SERVICE,
      regionTaxRates: [{ tax_percentage: 6.875 }],
    });
    await QuoteItem.create(
      untaxedButIncluded.knex, TENANT,
      { ...baseItem, service_id: SERVICE_ID, is_taxable: true } as any,
    );
    expect(untaxedButIncluded.insertedItem().is_taxable).toBe(true);
    expect(untaxedButIncluded.lastItemUpdate().tax_amount).toBe(688);
  });

  it('keeps a custom line with no catalog identity explicitly taxable', async () => {
    const h = buildHarness({ service: null, regionTaxRates: [{ tax_percentage: 6.875 }] });

    await QuoteItem.create(h.knex, TENANT, { ...baseItem, service_id: null } as any);

    // Explicit on insert so the column default never decides.
    expect(h.insertedItem().is_taxable).toBe(true);
  });
});

describe('crmWorkerDal createQuoteItemSchema', () => {
  it('does not inject is_taxable when the caller omits it', () => {
    const parsed = createQuoteItemSchema.parse({ ...baseItem, quote_id: QUOTE_ID });
    expect('is_taxable' in parsed).toBe(false);
  });

  it('accepts a fractional tax_rate now that the column is numeric', () => {
    const parsed = createQuoteItemSchema.parse({ ...baseItem, quote_id: QUOTE_ID, tax_rate: 6.875 });
    expect(parsed.tax_rate).toBe(6.875);
  });
});
