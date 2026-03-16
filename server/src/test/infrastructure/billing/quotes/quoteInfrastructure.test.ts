import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }

      return {
        knex: mockedTenantConnection.db,
        tenant: mockedTenantConnection.tenant,
      };
    }),
  };
});

import { SharedNumberingService } from '@shared/services/numberingService';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTenant, createClient, createClientLocation } from '../../../../../test-utils/testDataFactory';
import { createTestService, setupClientTaxConfiguration } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteActivity from '../../../../../../packages/billing/src/models/quoteActivity';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import { mapDbQuoteToViewModel } from '../../../../../../packages/billing/src/lib/adapters/quoteAdapters';
import { getStandardQuoteTemplateAstByCode } from '../../../../../../packages/billing/src/lib/quote-template-ast/standardTemplates';
import { resolveQuoteTemplateAst } from '../../../../../../packages/billing/src/lib/quote-template-ast/templateSelection';
import { evaluateInvoiceTemplateAst } from '../../../../../../packages/billing/src/lib/invoice-template-ast/evaluator';
import { createQuotePDFGenerationService } from '../../../../../../packages/billing/src/services/quotePdfGenerationService';
import { browserPoolService } from '../../../../../../packages/billing/src/services/browserPoolService';
import { TaxService } from '../../../../../../packages/billing/src/services/taxService';

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Quote infrastructure', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  async function createFinancialQuote(overrides: Record<string, unknown> = {}) {
    return Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Financial quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
      ...overrides,
    });
  }

  async function loadQuoteRow(quoteId: string) {
    return context.db('quotes').where({ tenant: context.tenantId, quote_id: quoteId }).first();
  }

  async function loadQuoteItemRow(quoteItemId: string) {
    return context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: quoteItemId }).first();
  }

  it('T001: Migration creates quotes table with expected columns and types', async () => {
    const columns = await context.db('quotes').columnInfo();

    expect(columns.quote_id.type).toBe('uuid');
    expect(columns.title.type).toBe('text');
    expect(columns.is_template.type).toBe('boolean');
    expect(columns.version.type).toBe('integer');
    expect(columns.total_amount.type).toBe('bigint');
  });

  it('T002: Migration creates the expected quotes indexes', async () => {
    const indexes = await context.db('pg_indexes')
      .where({ tablename: 'quotes' })
      .pluck('indexname');

    expect(indexes).toEqual(expect.arrayContaining([
      'idx_quotes_tenant_client',
      'idx_quotes_tenant_status',
      'idx_quotes_tenant_quote_number',
      'idx_quotes_tenant_parent_quote',
    ]));
  });


  it('T119a: Approval migration allows pending_approval and approved in the quote status constraint', async () => {
    const constraint = await context.db('pg_constraint as c')
      .join('pg_class as t', 'c.conrelid', 't.oid')
      .select(context.db.raw('pg_get_constraintdef(c.oid) as definition'))
      .where('t.relname', 'quotes')
      .where('c.conname', 'quotes_status_check')
      .first<{ definition: string }>();

    expect(constraint?.definition).toContain("'pending_approval'");
    expect(constraint?.definition).toContain("'approved'");
  });

  it('T003: Migration creates quote_items with quote-specific fields', async () => {
    const columns = await context.db('quote_items').columnInfo();

    expect(columns.quote_item_id.type).toBe('uuid');
    expect(columns.quantity.type).toBe('bigint');
    expect(columns.is_optional.type).toBe('boolean');
    expect(columns.is_selected.type).toBe('boolean');
    expect(columns.is_recurring.type).toBe('boolean');
    expect(columns.phase.type).toBe('text');
  });

  it('T004: Migration wires quote_items FK to quotes with cascade delete', async () => {
    const fk = await context.db.raw(`
      SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'quote_items'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name LIKE '%quote_id%'
      LIMIT 1
    `);

    expect(fk.rows[0]?.delete_rule).toBe('CASCADE');
  });

  it('T005: Migration creates quote_activities with expected columns and quote FK', async () => {
    const columns = await context.db('quote_activities').columnInfo();
    expect(columns.activity_id.type).toBe('uuid');
    expect(columns.activity_type.type).toBe('text');
    expect(columns.metadata.type).toBe('jsonb');

    const fk = await context.db.raw(`
      SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'quote_activities'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc.constraint_name LIKE '%quote_id%'
      LIMIT 1
    `);
    expect(fk.rows[0]?.delete_rule).toBe('CASCADE');
  });

  it('T006: Numbering generates Q-0001 on first quote call', async () => {
    const nextNumber = await SharedNumberingService.getNextNumber('QUOTE', {
      knex: context.db,
      tenant: context.tenantId,
    });

    expect(nextNumber).toBe('Q-0001');
  });

  it('T007: Numbering generates a sequential quote series', async () => {
    const first = await SharedNumberingService.getNextNumber('QUOTE', { knex: context.db, tenant: context.tenantId });
    const second = await SharedNumberingService.getNextNumber('QUOTE', { knex: context.db, tenant: context.tenantId });
    const third = await SharedNumberingService.getNextNumber('QUOTE', { knex: context.db, tenant: context.tenantId });

    expect([first, second, third]).toEqual(['Q-0001', 'Q-0002', 'Q-0003']);
  });

  it('T008: Numbering keeps quote sequences isolated by tenant', async () => {
    const otherTenantId = await createTenant(context.db);

    const firstTenantNumber = await SharedNumberingService.getNextNumber('QUOTE', { knex: context.db, tenant: context.tenantId });
    const secondTenantNumber = await SharedNumberingService.getNextNumber('QUOTE', { knex: context.db, tenant: otherTenantId });

    expect(firstTenantNumber).toBe('Q-0001');
    expect(secondTenantNumber).toBe('Q-0001');
  });

  it('T018: getById returns a tenant-scoped quote with items', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Tenant quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Onboarding',
      quantity: 1,
      unit_price: 5000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    const loadedQuote = await Quote.getById(context.db, context.tenantId, quote.quote_id);
    expect(loadedQuote?.quote_id).toBe(quote.quote_id);
    expect(loadedQuote?.quote_items).toHaveLength(1);
  });

  it('T019: getById returns null for the wrong tenant', async () => {
    const otherTenantId = await createTenant(context.db);
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Tenant quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const loadedQuote = await Quote.getById(context.db, otherTenantId, quote.quote_id);
    expect(loadedQuote).toBeNull();
  });

  it('T020: getById auto-expires sent quotes past valid_until', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Expiring quote',
      quote_date: '2026-03-01T00:00:00.000Z',
      valid_until: '2026-03-02T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      status: 'sent',
      created_by: context.userId,
    });

    const loadedQuote = await Quote.getById(context.db, context.tenantId, quote.quote_id);
    expect(loadedQuote?.status).toBe('expired');
  });

  it('T021: getById does not auto-expire drafts or accepted quotes', async () => {
    const draftQuote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Draft quote',
      quote_date: '2026-03-01T00:00:00.000Z',
      valid_until: '2026-03-02T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const acceptedQuote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Accepted quote',
      quote_date: '2026-03-01T00:00:00.000Z',
      valid_until: '2026-03-02T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      status: 'accepted',
      created_by: context.userId,
    });

    expect((await Quote.getById(context.db, context.tenantId, draftQuote.quote_id))?.status).toBe('draft');
    expect((await Quote.getById(context.db, context.tenantId, acceptedQuote.quote_id))?.status).toBe('accepted');
  });

  it('T051: Tax: calculateTax called per taxable item with correct net_amount and region', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });

    const serviceId = await createTestService(context, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 1500,
    });

    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Taxable quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const calculateTaxSpy = vi.spyOn(TaxService.prototype, 'calculateTax').mockResolvedValue({ taxAmount: 270, taxRate: 9 });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Managed Endpoint',
      quantity: 2,
      unit_price: 1500,
      is_taxable: true,
      created_by: context.userId,
    });

    expect(calculateTaxSpy).toHaveBeenCalledWith(
      context.clientId,
      3000,
      expect.any(String),
      'US-NY',
      true,
      'USD'
    );

    calculateTaxSpy.mockRestore();
  });

  it('T052: Tax: is_taxable=false items get zero tax_amount', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });

    const serviceId = await createTestService(context, {
      service_name: 'Non-taxable Service',
      billing_method: 'fixed',
      default_rate: 5000,
    });

    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Non-taxable quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Non-taxable Service',
      quantity: 1,
      unit_price: 5000,
      is_taxable: false,
      created_by: context.userId,
    });

    const reloadedItem = await context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: item.quote_item_id }).first();
    expect(Number(reloadedItem.tax_amount)).toBe(0);
  });

  it('T053: Tax: tax-exempt client gets zero tax on all items', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: true });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });

    const serviceId = await createTestService(context, {
      service_name: 'Exempt Service',
      billing_method: 'fixed',
      default_rate: 5000,
    });

    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Tax exempt quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Exempt Service',
      quantity: 1,
      unit_price: 5000,
      is_taxable: true,
      created_by: context.userId,
    });

    const reloadedItem = await context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: item.quote_item_id }).first();
    expect(Number(reloadedItem.tax_amount)).toBe(0);
  });

  it('T054: Tax: reverse charge applicable client gets zero tax', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });
    await context.db('client_tax_settings')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ is_reverse_charge_applicable: true });

    const serviceId = await createTestService(context, {
      service_name: 'Reverse Charge Service',
      billing_method: 'fixed',
      default_rate: 5000,
    });

    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Reverse charge quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Reverse Charge Service',
      quantity: 1,
      unit_price: 5000,
      is_taxable: true,
      created_by: context.userId,
    });

    const reloadedItem = await context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: item.quote_item_id }).first();
    expect(Number(reloadedItem.tax_amount)).toBe(0);
  });

  it('T055: Tax: per-item tax_region and tax_rate stored correctly after calculation', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 8.875 });

    const serviceId = await createTestService(context, {
      service_name: 'Regional Tax Service',
      billing_method: 'fixed',
      default_rate: 10000,
    });

    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Regional tax quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Regional Tax Service',
      quantity: 1,
      unit_price: 10000,
      is_taxable: true,
      created_by: context.userId,
    });

    const reloadedItem = await context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: item.quote_item_id }).first();
    expect(reloadedItem.tax_region).toBe('US-NY');
    expect(Number(reloadedItem.tax_rate)).toBe(9);
    expect(Number(reloadedItem.tax_amount)).toBeGreaterThan(0);
  });

  it('T056: Discount: percentage discount calculates correct amount from target item total', async () => {
    const quote = await createFinancialQuote();

    const baseItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Primary line',
      quantity: 2,
      unit_price: 500,
      is_taxable: false,
      created_by: context.userId,
    });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: '10% off',
      quantity: 1,
      unit_price: 0,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      applies_to_item_id: baseItem.quote_item_id,
      created_by: context.userId,
    });

    const reloadedDiscount = await loadQuoteItemRow(discountItem.quote_item_id);
    expect(Number(reloadedDiscount.total_price)).toBe(100);
    expect(Number(reloadedDiscount.net_amount)).toBe(100);
  });

  it('T057: Discount: fixed discount stores exact amount as total_price', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Primary line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Fixed discount',
      quantity: 1,
      unit_price: 250,
      is_discount: true,
      discount_type: 'fixed',
      created_by: context.userId,
    });

    const reloadedDiscount = await loadQuoteItemRow(discountItem.quote_item_id);
    expect(Number(reloadedDiscount.total_price)).toBe(250);
  });

  it("T058: Discount: applies_to_item_id scopes discount to specific item's net_amount", async () => {
    const quote = await createFinancialQuote();

    const firstItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Targeted item',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Untargeted item',
      quantity: 1,
      unit_price: 2000,
      is_taxable: false,
      created_by: context.userId,
    });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: '50% targeted discount',
      quantity: 1,
      unit_price: 0,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 50,
      applies_to_item_id: firstItem.quote_item_id,
      created_by: context.userId,
    });

    const reloadedDiscount = await loadQuoteItemRow(discountItem.quote_item_id);
    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedDiscount.total_price)).toBe(500);
    expect(Number(reloadedQuote.discount_total)).toBe(500);
  });

  it('T059: Discount: applies_to_service_id scopes discount to all items of that service', async () => {
    const targetServiceId = await createTestService(context, {
      service_name: 'Target service',
      billing_method: 'fixed',
      default_rate: 1000,
    });
    const otherServiceId = await createTestService(context, {
      service_name: 'Other service',
      billing_method: 'fixed',
      default_rate: 5000,
    });

    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: targetServiceId,
      description: 'Target one',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: targetServiceId,
      description: 'Target two',
      quantity: 1,
      unit_price: 3000,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: otherServiceId,
      description: 'Other item',
      quantity: 1,
      unit_price: 5000,
      is_taxable: false,
      created_by: context.userId,
    });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: '10% target service discount',
      quantity: 1,
      unit_price: 0,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      applies_to_service_id: targetServiceId,
      created_by: context.userId,
    });

    const reloadedDiscount = await loadQuoteItemRow(discountItem.quote_item_id);
    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedDiscount.total_price)).toBe(400);
    expect(Number(reloadedQuote.discount_total)).toBe(400);
  });

  it('T060: Discount: quote-level discount (no target) applies to full subtotal', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Line one',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Line two',
      quantity: 1,
      unit_price: 2000,
      is_taxable: false,
      created_by: context.userId,
    });

    const discountItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: '10% quote discount',
      quantity: 1,
      unit_price: 0,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      created_by: context.userId,
    });

    const reloadedDiscount = await loadQuoteItemRow(discountItem.quote_item_id);
    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedDiscount.total_price)).toBe(300);
    expect(Number(reloadedQuote.discount_total)).toBe(300);
  });

  it('T061: Totals: subtotal equals sum of non-discount item total_prices', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Line one',
      quantity: 2,
      unit_price: 600,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Line two',
      quantity: 1,
      unit_price: 800,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Discount',
      quantity: 1,
      unit_price: 100,
      is_discount: true,
      discount_type: 'fixed',
      created_by: context.userId,
    });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(2000);
  });

  it('T062: Totals: discount_total equals sum of discount line amounts', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Base item',
      quantity: 1,
      unit_price: 3000,
      is_taxable: false,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Discount one',
      quantity: 1,
      unit_price: 100,
      is_discount: true,
      discount_type: 'fixed',
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Discount two',
      quantity: 1,
      unit_price: 250,
      is_discount: true,
      discount_type: 'fixed',
      created_by: context.userId,
    });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.discount_total)).toBe(350);
  });

  it('T063: Totals: total_amount = subtotal - discount_total + tax', async () => {
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: 'US-NY', is_tax_exempt: false });
    await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 10 });

    const serviceId = await createTestService(context, {
      service_name: 'Taxed service',
      billing_method: 'fixed',
      default_rate: 500,
    });

    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Taxed line',
      quantity: 2,
      unit_price: 500,
      is_taxable: true,
      created_by: context.userId,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Fixed discount',
      quantity: 1,
      unit_price: 100,
      is_discount: true,
      discount_type: 'fixed',
      created_by: context.userId,
    });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(1000);
    expect(Number(reloadedQuote.discount_total)).toBe(100);
    expect(Number(reloadedQuote.tax)).toBe(100);
    expect(Number(reloadedQuote.total_amount)).toBe(1000);
  });

  it('T064: Totals: adding an item triggers recalculation of all totals', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'First line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Second line',
      quantity: 1,
      unit_price: 500,
      is_taxable: false,
      created_by: context.userId,
    });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(1500);
    expect(Number(reloadedQuote.total_amount)).toBe(1500);
  });

  it('T065: Totals: removing an item triggers recalculation', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'First line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    const secondItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Second line',
      quantity: 1,
      unit_price: 500,
      is_taxable: false,
      created_by: context.userId,
    });

    await QuoteItem.delete(context.db, context.tenantId, secondItem.quote_item_id);

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(1000);
    expect(Number(reloadedQuote.total_amount)).toBe(1000);
  });

  it('T066: Totals: toggling optional item off excludes it from totals', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Required line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    const optionalItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Optional line',
      quantity: 1,
      unit_price: 500,
      is_optional: true,
      is_selected: true,
      is_taxable: false,
      created_by: context.userId,
    });

    await QuoteItem.update(context.db, context.tenantId, optionalItem.quote_item_id, { is_selected: false });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(1000);
    expect(Number(reloadedQuote.total_amount)).toBe(1000);
  });

  it('T067: Totals: toggling optional item back on includes it in totals', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Required line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    const optionalItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Optional line',
      quantity: 1,
      unit_price: 500,
      is_optional: true,
      is_selected: true,
      is_taxable: false,
      created_by: context.userId,
    });

    await QuoteItem.update(context.db, context.tenantId, optionalItem.quote_item_id, { is_selected: false });
    await QuoteItem.update(context.db, context.tenantId, optionalItem.quote_item_id, { is_selected: true });

    const reloadedQuote = await loadQuoteRow(quote.quote_id);
    expect(Number(reloadedQuote.subtotal)).toBe(1500);
    expect(Number(reloadedQuote.total_amount)).toBe(1500);
  });

  it('T068: Versioning: revise creates new quote row with version+1 and parent_quote_id set', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Revision source line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    const revision = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);

    expect(revision.version).toBe(2);
    expect(revision.parent_quote_id).toBe(quote.quote_id);
    expect(revision.status).toBe('draft');
  });

  it('T069: Versioning: revise copies all quote_items to new version with new item_ids', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    const firstItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Copied line one',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });
    const secondItem = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Copied line two',
      quantity: 2,
      unit_price: 300,
      is_taxable: false,
      created_by: context.userId,
    });

    const revision = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);

    expect(revision.quote_items).toHaveLength(2);
    expect(revision.quote_items?.map((item) => item.description)).toEqual(['Copied line one', 'Copied line two']);
    expect(revision.quote_items?.some((item) => item.quote_item_id === firstItem.quote_item_id || item.quote_item_id === secondItem.quote_item_id)).toBe(false);
  });

  it('T070: Versioning: old version status set to superseded after revision', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Superseded line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);

    const sourceQuote = await loadQuoteRow(quote.quote_id);
    expect(sourceQuote.status).toBe('superseded');
  });

  it('T071: Versioning: new version has same quote_number as original', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    const revision = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);

    expect(revision.quote_number).toBe(quote.quote_number);
  });

  it('T072: Versioning: can revise a rejected quote (creates new version from rejected)', async () => {
    const quote = await createFinancialQuote({ status: 'rejected' });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Rejected source line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    const revision = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);

    expect(revision.version).toBe(2);
    expect(revision.parent_quote_id).toBe(quote.quote_id);
    expect(revision.status).toBe('draft');
  });

  it('T073: Version history: query returns all versions ordered by version number', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    const revisionTwo = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);
    await Quote.update(context.db, context.tenantId, revisionTwo.quote_id, { status: 'sent', updated_by: context.userId });
    const revisionThree = await Quote.createRevision(context.db, context.tenantId, revisionTwo.quote_id, context.userId);

    const versions = await Quote.listVersions(context.db, context.tenantId, quote.quote_id);
    expect(versions.map((version) => version.version)).toEqual([1, 2, 3]);
    expect(versions[2].quote_id).toBe(revisionThree.quote_id);
  });

  it('T074: Version history: works for quotes with 3+ versions', async () => {
    const quote = await createFinancialQuote({ status: 'sent' });

    const revisionTwo = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);
    await Quote.update(context.db, context.tenantId, revisionTwo.quote_id, { status: 'sent', updated_by: context.userId });
    const revisionThree = await Quote.createRevision(context.db, context.tenantId, revisionTwo.quote_id, context.userId);

    const versions = await Quote.listVersions(context.db, context.tenantId, revisionThree.quote_id);
    expect(versions).toHaveLength(3);
    expect(versions.at(-1)?.version).toBe(3);
  });

  it('T075: Template migration: quote_templates table has templateAst JSONB column', async () => {
    const columns = await context.db('quote_document_templates').columnInfo();

    expect(columns.templateAst.type).toBe('jsonb');
  });

  it('T076: Template migration: standard_quote_templates seeded with default and detailed templates', async () => {
    const rows = await context.db('standard_quote_document_templates')
      .select('standard_quote_document_template_code')
      .orderBy('standard_quote_document_template_code', 'asc');

    expect(rows.map((row) => row.standard_quote_document_template_code)).toEqual([
      'standard-quote-default',
      'standard-quote-detailed',
    ]);
  });

  it('T076a: Template migration: standard quote template seed upsert succeeds on repeated runs', async () => {
    const migration = await import('../../../../../migrations/20260313131000_create_standard_quote_document_templates.cjs');

    await migration.up(context.db);
    await migration.up(context.db);

    const rows = await context.db('standard_quote_document_templates')
      .select('standard_quote_document_template_code')
      .orderBy('standard_quote_document_template_code', 'asc');

    expect(rows.map((row) => row.standard_quote_document_template_code)).toEqual([
      'standard-quote-default',
      'standard-quote-detailed',
    ]);
  });

  it('T077: QuoteViewModel: correctly maps all quote fields including items with optional/recurring metadata', async () => {
    const quote = await createFinancialQuote({
      title: 'Mapped quote',
      description: 'Mapped scope',
      client_notes: 'Client note',
      terms_and_conditions: 'Net 30',
    });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Mapped line',
      quantity: 2,
      unit_price: 1500,
      phase: 'Phase 1',
      is_optional: true,
      is_selected: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      is_taxable: false,
      created_by: context.userId,
    });

    const viewModel = await mapDbQuoteToViewModel(context.db, context.tenantId, quote.quote_id);

    expect(viewModel?.quote_number).toBe(quote.quote_number);
    expect(viewModel?.title).toBe('Mapped quote');
    expect(viewModel?.scope_of_work).toBe('Mapped scope');
    expect(viewModel?.line_items[0]).toMatchObject({
      description: 'Mapped line',
      is_optional: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      phase: 'Phase 1',
    });
    expect(viewModel?.phases[0]?.name).toBe('Phase 1');
  });

  it('T078: AST bindings: quoteNumber, quoteDate, validUntil resolve to correct quote values', async () => {
    const quote = await createFinancialQuote();
    const viewModel = await mapDbQuoteToViewModel(context.db, context.tenantId, quote.quote_id);
    const ast = getStandardQuoteTemplateAstByCode('standard-quote-default');

    expect(viewModel).toBeTruthy();
    expect(ast).toBeTruthy();

    const evaluation = evaluateInvoiceTemplateAst(ast!, viewModel as unknown as Record<string, unknown>);
    expect(evaluation.bindings.quoteNumber).toBe(quote.quote_number);
    expect(String(evaluation.bindings.quoteDate)).toBe(String(quote.quote_date));
    expect(String(evaluation.bindings.validUntil)).toBe(String(quote.valid_until));
  });

  it('T079: AST bindings: lineItems collection includes is_optional and is_recurring flags per item', async () => {
    const quote = await createFinancialQuote();

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Bound line',
      quantity: 1,
      unit_price: 1000,
      is_optional: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      is_taxable: false,
      created_by: context.userId,
    });

    const viewModel = await mapDbQuoteToViewModel(context.db, context.tenantId, quote.quote_id);
    const ast = getStandardQuoteTemplateAstByCode('standard-quote-default');
    const evaluation = evaluateInvoiceTemplateAst(ast!, viewModel as unknown as Record<string, unknown>);
    const [lineItem] = evaluation.bindings.lineItems as Array<Record<string, unknown>>;

    expect(lineItem.is_optional).toBe(true);
    expect(lineItem.is_recurring).toBe(true);
  });

  it('T080: Standard template: standard-quote-default renders valid HTML with all sections', async () => {
    const quote = await createFinancialQuote({ description: 'Scope copy', terms_and_conditions: 'Standard terms' });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Rendered line',
      quantity: 1,
      unit_price: 1000,
      is_taxable: false,
      created_by: context.userId,
    });

    const preview = await createQuotePDFGenerationService(context.tenantId).renderPreview({
      quoteId: quote.quote_id,
      templateCode: 'standard-quote-default',
    });

    expect(preview.html).toContain('Quote');
    expect(preview.html).toContain('Scope of Work');
    expect(preview.html).toContain('Validity');
    expect(preview.html).toContain('Terms &amp; Conditions');
    expect(preview.html).toContain('Rendered line');
  });

  it('T081: Standard template: standard-quote-detailed renders phase grouping and optional item markers', async () => {
    const quote = await createFinancialQuote({ description: 'Detailed scope', terms_and_conditions: 'Detailed terms' });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Detailed line',
      quantity: 1,
      unit_price: 1000,
      phase: 'Phase 1',
      is_optional: true,
      is_recurring: true,
      billing_frequency: 'monthly',
      is_taxable: false,
      created_by: context.userId,
    });

    const preview = await createQuotePDFGenerationService(context.tenantId).renderPreview({
      quoteId: quote.quote_id,
      templateCode: 'standard-quote-detailed',
    });

    expect(preview.html).toContain('Overview');
    expect(preview.html).toContain('Phase');
    expect(preview.html).toContain('Optional');
    expect(preview.html).toContain('Recurring');
    expect(preview.html).toContain('Phase 1');
  });

  it('T082: Adapter: mapDbQuoteToViewModel fetches and joins client, contact, tenant data', async () => {
    const contactId = crypto.randomUUID();
    await context.db('contacts').insert({
      tenant: context.tenantId,
      contact_name_id: contactId,
      full_name: 'Billing Contact',
      email: 'billing-contact@example.com',
      client_id: context.clientId,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now(),
    });
    await context.db('contact_phone_numbers').insert({
      tenant: context.tenantId,
      contact_phone_number_id: crypto.randomUUID(),
      contact_name_id: contactId,
      phone_number: '555-1212',
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
      created_at: context.db.fn.now(),
      updated_at: context.db.fn.now(),
    });

    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ billing_email: 'client-billing@example.com' });
    await createClientLocation(context.db, context.clientId, context.tenantId, {
      address_line1: '100 Client Way',
      city: 'Albany',
      state_province: 'NY',
      postal_code: '12207',
      country_name: 'United States',
    });
    await context.db('client_locations')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ is_default: true, is_billing_address: true });

    const tenantClientId = await createClient(context.db, context.tenantId, 'Tenant HQ', { billing_email: 'hq@example.com' });
    await createClientLocation(context.db, tenantClientId, context.tenantId, {
      address_line1: '1 MSP Plaza',
      city: 'Buffalo',
      state_province: 'NY',
      postal_code: '14202',
      country_name: 'United States',
    });
    await context.db('client_locations')
      .where({ tenant: context.tenantId, client_id: tenantClientId })
      .update({ is_default: true, is_billing_address: true });
    await context.db('tenant_companies').insert({
      tenant: context.tenantId,
      client_id: tenantClientId,
      is_default: true,
    }).onConflict(['tenant', 'client_id']).ignore();

    const quote = await createFinancialQuote({ contact_id: contactId });
    const viewModel = await mapDbQuoteToViewModel(context.db, context.tenantId, quote.quote_id);

    expect(viewModel?.client?.name).toBe('Test Client');
    expect(viewModel?.client?.email).toBe('client-billing@example.com');
    expect(viewModel?.contact?.name).toBe('Billing Contact');
    expect(viewModel?.contact?.phone).toBe('555-1212');
    expect(viewModel?.tenant?.name).toBe('Tenant HQ');
    expect(viewModel?.tenant?.address).toContain('1 MSP Plaza');
  });

  it('T085: Preview: renders quote template in-browser without Puppeteer', async () => {
    const quote = await createFinancialQuote();
    const getBrowserSpy = vi.spyOn(browserPoolService, 'getBrowser');

    const preview = await createQuotePDFGenerationService(context.tenantId).renderPreview({
      quoteId: quote.quote_id,
      templateCode: 'standard-quote-default',
    });

    expect(preview.html.length).toBeGreaterThan(0);
    expect(getBrowserSpy).not.toHaveBeenCalled();
    getBrowserSpy.mockRestore();
  });

  it('T086: Template selection: uses quote-specific template_id if set', async () => {
    const customTemplateId = crypto.randomUUID();
    await context.db('quote_document_templates').insert({
      tenant: context.tenantId,
      template_id: customTemplateId,
      name: 'Custom Quote Template',
      version: 1,
      templateAst: getStandardQuoteTemplateAstByCode('standard-quote-detailed'),
      is_default: false,
    });

    const quote = await createFinancialQuote({ template_id: customTemplateId });
    const resolved = await resolveQuoteTemplateAst(context.db, context.tenantId, quote.quote_id);

    expect(resolved.source).toBe('quote');
    expect(resolved.templateId).toBe(customTemplateId);
  });

  it('T087: Template selection: falls back to tenant default when no per-quote template', async () => {
    await context.db('quote_document_template_assignments').insert({
      tenant: context.tenantId,
      scope_type: 'tenant',
      scope_id: null,
      template_source: 'standard',
      standard_quote_document_template_code: 'standard-quote-detailed',
      created_by: context.userId,
    });

    const quote = await createFinancialQuote();
    const resolved = await resolveQuoteTemplateAst(context.db, context.tenantId, quote.quote_id);

    expect(resolved.source).toBe('tenant-default');
    expect(resolved.standardCode).toBe('standard-quote-detailed');
  });

  it('T088: Template selection: falls back to standard-quote-default when no tenant default', async () => {
    const quote = await createFinancialQuote();
    const resolved = await resolveQuoteTemplateAst(context.db, context.tenantId, quote.quote_id);

    expect(resolved.source).toBe('standard-fallback');
    expect(resolved.standardCode).toBe('standard-quote-default');
  });

  it('T022: getByNumber returns the correct quote within a tenant', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Lookup quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const loadedQuote = await Quote.getByNumber(context.db, context.tenantId, quote.quote_number!);
    expect(loadedQuote?.quote_id).toBe(quote.quote_id);
  });

  it('T023: listByTenant returns paginated results with total count', async () => {
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Quote A',
      quote_date: '2026-03-11T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Quote B',
      quote_date: '2026-03-12T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const result = await Quote.listByTenant(context.db, context.tenantId, { page: 1, pageSize: 1 });
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(1);
  });

  it('T024: listByTenant filters by status', async () => {
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Draft quote',
      quote_date: '2026-03-11T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Sent quote',
      quote_date: '2026-03-12T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      status: 'sent',
      created_by: context.userId,
    });

    const result = await Quote.listByTenant(context.db, context.tenantId, { status: 'sent' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('sent');
  });

  it('T025: listByTenant filters by client_id', async () => {
    const otherClientId = await createClient(context.db, context.tenantId, 'Second Client');
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Client one quote',
      quote_date: '2026-03-11T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    await Quote.create(context.db, context.tenantId, {
      client_id: otherClientId,
      title: 'Client two quote',
      quote_date: '2026-03-12T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const result = await Quote.listByTenant(context.db, context.tenantId, { client_id: otherClientId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].client_id).toBe(otherClientId);
  });

  it('T026: listByTenant sorts by quote_date descending by default', async () => {
    const older = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Older quote',
      quote_date: '2026-03-11T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const newer = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Newer quote',
      quote_date: '2026-03-12T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const result = await Quote.listByTenant(context.db, context.tenantId);
    expect(result.data[0].quote_id).toBe(newer.quote_id);
    expect(result.data[1].quote_id).toBe(older.quote_id);
  });

  it('T027: listByClient returns only quotes for the specified client', async () => {
    const otherClientId = await createClient(context.db, context.tenantId, 'Second Client');
    await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Client one quote',
      quote_date: '2026-03-11T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    await Quote.create(context.db, context.tenantId, {
      client_id: otherClientId,
      title: 'Client two quote',
      quote_date: '2026-03-12T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const result = await Quote.listByClient(context.db, context.tenantId, otherClientId);
    expect(result).toHaveLength(1);
    expect(result[0].client_id).toBe(otherClientId);
  });

  it('T028: create inserts a quote with generated number and a created activity', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Created quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const activities = await QuoteActivity.listByQuoteId(context.db, context.tenantId, quote.quote_id);

    expect(quote.quote_number).toBe('Q-0001');
    expect(activities.map((activity) => activity.activity_type)).toContain('created');
  });

  it('T029: create sets the default status to draft', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Draft quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    expect(quote.status).toBe('draft');
  });

  it('T030: update changes fields and logs an updated activity', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Editable quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const updated = await Quote.update(context.db, context.tenantId, quote.quote_id, {
      title: 'Updated title',
      updated_by: context.userId,
    });
    const activities = await QuoteActivity.listByQuoteId(context.db, context.tenantId, quote.quote_id);

    expect(updated.title).toBe('Updated title');
    expect(activities.map((activity) => activity.activity_type)).toContain('updated');
  });

  it('T031: update rejects invalid status transitions', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Invalid transition quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    await expect(
      Quote.update(context.db, context.tenantId, quote.quote_id, { status: 'accepted' })
    ).rejects.toThrow('Invalid quote status transition');
  });

  it('T032: delete removes draft quotes with no business history', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Delete me',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const result = await Quote.delete(context.db as any, context.tenantId, quote.quote_id);
    const deletedQuote = await context.db('quotes').where({ tenant: context.tenantId, quote_id: quote.quote_id }).first();

    expect(result.deleted).toBe(true);
    expect(deletedQuote).toBeUndefined();
  });

  it('T033: delete blocks non-draft quotes and offers archive alternative', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Sent quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      status: 'sent',
      created_by: context.userId,
    });

    const result = await Quote.delete(context.db as any, context.tenantId, quote.quote_id);

    expect(result.deleted).toBeUndefined();
    expect(result.canDelete).toBe(false);
    expect(result.alternatives.some((alternative) => alternative.action === 'archive')).toBe(true);
  });

  it('T033a: delete blocks drafts that have business history and offers archive', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Draft with email history',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    await context.db('email_sending_logs').insert({
      tenant: context.tenantId,
      provider_id: 'provider-1',
      provider_type: 'smtp',
      from_address: 'billing@example.com',
      to_addresses: JSON.stringify(['client@example.com']),
      status: 'sent',
      sent_at: new Date(),
      entity_type: 'quote',
      entity_id: quote.quote_id,
    });

    const result = await Quote.delete(context.db as any, context.tenantId, quote.quote_id);
    expect(result.canDelete).toBe(false);
    expect(result.alternatives.some((alternative) => alternative.action === 'archive')).toBe(true);
  });

  it('T034: item listByQuoteId returns items ordered by display_order', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Ordered items quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const second = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Second',
      quantity: 1,
      unit_price: 2000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      display_order: 1,
    });
    const first = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'First',
      quantity: 1,
      unit_price: 1000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      display_order: 0,
    });

    const items = await QuoteItem.listByQuoteId(context.db, context.tenantId, quote.quote_id);
    expect(items.map((item) => item.quote_item_id)).toEqual([first.quote_item_id, second.quote_item_id]);
  });

  it('T035: item create with service_id populates service defaults from the catalog', async () => {
    const serviceId = await createTestService(context, {
      service_name: 'Managed Services',
      billing_method: 'fixed',
      default_rate: 7500,
      unit_of_measure: 'seat',
    });
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Catalog quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      service_id: serviceId,
      description: 'Managed Services',
      quantity: 2,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    expect(item.service_name).toBe('Managed Services');
    expect(item.unit_price).toBe(7500);
    expect(item.unit_of_measure).toBe('seat');
  });

  it('T036: item create without service_id allows manual item entry', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Manual item quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Project kickoff',
      quantity: 1,
      unit_price: 3500,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    expect(item.service_id).toBeNull();
    expect(item.description).toBe('Project kickoff');
  });

  it('T037: item update allows a unit price override', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Override item quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const item = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Project kickoff',
      quantity: 1,
      unit_price: 3500,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    const updated = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, { unit_price: 4000 });
    expect(updated.unit_price).toBe(4000);
  });

  it('T038: item delete adjusts display_order for remaining items', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Delete item quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const first = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'First',
      quantity: 1,
      unit_price: 1000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });
    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Second',
      quantity: 1,
      unit_price: 2000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });
    const third = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Third',
      quantity: 1,
      unit_price: 3000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    await QuoteItem.delete(context.db, context.tenantId, first.quote_item_id);
    const items = await QuoteItem.listByQuoteId(context.db, context.tenantId, quote.quote_id);

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.quote_item_id === third.quote_item_id)?.display_order).toBe(1);
  });

  it('T039: item reorder updates display_order in batch', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Reorder item quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
    const first = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'First',
      quantity: 1,
      unit_price: 1000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });
    const second = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Second',
      quantity: 1,
      unit_price: 2000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });

    const items = await QuoteItem.reorder(context.db, context.tenantId, quote.quote_id, [second.quote_item_id, first.quote_item_id]);
    expect(items.map((item) => item.quote_item_id)).toEqual([second.quote_item_id, first.quote_item_id]);
  });

  it('T040: activity create stores fields with timestamps', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Activity quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    const activity = await QuoteActivity.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      activity_type: 'reviewed',
      description: 'Quote reviewed internally',
      performed_by: context.userId,
      metadata: { source: 'test' },
    });

    expect(activity.activity_type).toBe('reviewed');
    expect(activity.created_at).toBeTruthy();
  });

  it('T041: activity listByQuoteId returns entries in chronological order', async () => {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Activity ordering quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });

    await QuoteActivity.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      activity_type: 'sent',
      description: 'Quote sent',
      performed_by: context.userId,
      metadata: { order: 1 },
    });
    await QuoteActivity.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      activity_type: 'viewed',
      description: 'Quote viewed',
      performed_by: context.userId,
      metadata: { order: 2 },
    });

    const activities = await QuoteActivity.listByQuoteId(context.db, context.tenantId, quote.quote_id);
    expect(activities[0].activity_type).toBe('created');
    expect(activities[activities.length - 1].activity_type).toBe('viewed');
  });
});
