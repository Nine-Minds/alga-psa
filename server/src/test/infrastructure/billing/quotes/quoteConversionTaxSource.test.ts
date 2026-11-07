import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

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

import { TestContext } from '../../../../../test-utils/testContext';
import { createTestService, setupClientTaxConfiguration } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import {
  convertQuoteToDraftContract,
  convertQuoteToDraftInvoice,
} from '../../../../../../packages/billing/src/services/quoteConversionService';
import {
  convertQuoteToDraftContract as runtimeConvertQuoteToDraftContract,
  convertQuoteToDraftInvoice as runtimeConvertQuoteToDraftInvoice,
} from '../../../../../../shared/workflow/runtime/actions/businessOperations/crmWorkerDal';

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;

process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const QUOTE_DATE = '2026-03-10T00:00:00.000Z';
const VALID_UNTIL = '2026-03-25T00:00:00.000Z';
const ACCEPTED_AT = '2026-03-14T12:00:00.000Z';

type QuoteItemSpec = {
  description: string;
  quantity?: number;
  unit_price?: number;
  is_recurring?: boolean;
  billing_frequency?: string | null;
  service_id?: string;
  /** Written straight onto the persisted quote row (the quote's own estimate). */
  rawUpdates?: Record<string, unknown>;
};

/**
 * Quote conversion resolves invoice tax source from the client (alga-2026-0002902).
 *
 * A quote estimates tax internally because quotes never reach the accounting
 * system. The invoice it converts into must not inherit that flag: it resolves
 * the client's effective tax source like every other invoice path. An external
 * client's invoice goes out 'pending_external' with zero tax so the accounting
 * integration owns it; an internal client's invoice keeps the tax the customer
 * accepted on the quote. Converted contract lines must also carry the service's
 * catalog category so category-based billing splits see them.
 *
 * Lives beside quoteConversion.test.ts rather than inside it to keep this
 * behaviour out of the way of in-flight quote-side tax work.
 */
describe('quote conversion tax delegation and service category (alga-2026-0002902)', () => {
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
  }, 120000);

  async function createAcceptedQuote(itemSpecs: QuoteItemSpec[]) {
    const quote = await Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: `Conversion quote ${randomUUID().slice(0, 8)}`,
      description: 'Conversion scope',
      quote_date: QUOTE_DATE,
      valid_until: VALID_UNTIL,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    } as any);

    const createdItems = [] as any[];

    for (const spec of itemSpecs) {
      const serviceId = spec.service_id ?? await createTestService(context, {
        billing_method: 'fixed',
        default_rate: spec.unit_price ?? 1000,
        service_name: `${spec.description} Service`,
      });

      const createdItem = await QuoteItem.create(context.db, context.tenantId, {
        quote_id: quote.quote_id,
        service_id: serviceId,
        description: spec.description,
        quantity: spec.quantity ?? 1,
        unit_price: spec.unit_price ?? 1000,
        is_optional: false,
        is_selected: true,
        is_recurring: spec.is_recurring ?? false,
        billing_frequency: spec.billing_frequency ?? (spec.is_recurring ? 'monthly' : null),
        billing_method: 'fixed',
        is_taxable: true,
        created_by: context.userId,
      } as any);

      if (spec.rawUpdates) {
        await context.db('quote_items')
          .where({ tenant: context.tenantId, quote_item_id: createdItem.quote_item_id })
          .update(spec.rawUpdates);
      }

      createdItems.push({
        ...(await context.db('quote_items')
          .where({ tenant: context.tenantId, quote_item_id: createdItem.quote_item_id })
          .first()),
        service_id: serviceId,
      });
    }

    await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .update({
        status: 'accepted',
        accepted_at: ACCEPTED_AT,
        accepted_by: context.userId,
        updated_by: context.userId,
        // Quotes always estimate internally; the client decides for the invoice.
        tax_source: 'internal',
      });

    return {
      quote: (await Quote.getById(context.db, context.tenantId, quote.quote_id))!,
      items: createdItems,
    };
  }

  /** Tenant-wide external delegation, exactly as the reporting tenant is configured. */
  async function setTenantTaxSource(source: 'internal' | 'external') {
    await context.db('tenant_settings')
      .insert({ tenant: context.tenantId, default_tax_source: source })
      .onConflict('tenant')
      .merge({ default_tax_source: source });
  }

  async function readInvoice(invoiceId: string) {
    const header = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: invoiceId })
      .first();
    const charges = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: invoiceId })
      .orderBy('net_amount', 'desc');
    return { header, charges };
  }

  describe('external-tax clients hand invoice tax to the accounting integration', () => {
    it('invoice conversion writes pending_external with zero charge tax', async () => {
      // The quote row below carries a stored estimate that an internal client
      // would inherit: proof the delegation decision is what zeroes the tax.
      await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 10 });
      await setTenantTaxSource('external');

      const { quote } = await createAcceptedQuote([
        {
          description: 'Project implementation',
          quantity: 1,
          unit_price: 70000,
          rawUpdates: { net_amount: 70000, tax_amount: 4813, tax_rate: 7, total_price: 74813 },
        },
      ]);

      const result = await context.db.transaction((trx) =>
        convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      const netTotal = charges.reduce((sum, charge) => sum + Number(charge.net_amount), 0);

      expect(header.tax_source).toBe('pending_external');
      for (const charge of charges) {
        expect(Number(charge.tax_amount)).toBe(0);
        expect(Number(charge.total_price)).toBe(Number(charge.net_amount));
      }
      expect(Number(header.tax)).toBe(0);
      expect(Number(header.subtotal)).toBe(netTotal);
      expect(Number(header.total_amount)).toBe(netTotal);
    }, 60000);

    it('a client override alone delegates, even when the tenant default is internal', async () => {
      await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 10 });
      await setTenantTaxSource('internal');
      await context.db('client_tax_settings')
        .where({ tenant: context.tenantId, client_id: context.clientId })
        .update({ tax_source_override: 'external' });

      const { quote } = await createAcceptedQuote([
        {
          description: 'Onboarding',
          quantity: 1,
          unit_price: 50000,
          rawUpdates: { net_amount: 50000, tax_amount: 5000, tax_rate: 10, total_price: 55000 },
        },
      ]);

      const result = await context.db.transaction((trx) =>
        convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      expect(header.tax_source).toBe('pending_external');
      expect(Number(header.tax)).toBe(0);
      expect(charges.every((charge) => Number(charge.tax_amount) === 0)).toBe(true);
    }, 60000);

    it('the workflow-worker conversion path delegates the same way', async () => {
      await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 10 });
      await setTenantTaxSource('external');

      const { quote } = await createAcceptedQuote([
        {
          description: 'Runtime implementation',
          quantity: 1,
          unit_price: 70000,
          rawUpdates: { net_amount: 70000, tax_amount: 4813, tax_rate: 7, total_price: 74813 },
        },
      ]);

      const result = await context.db.transaction((trx) =>
        runtimeConvertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      expect(header.tax_source).toBe('pending_external');
      expect(Number(header.tax)).toBe(0);
      expect(Number(header.total_amount)).toBe(Number(header.subtotal));
      for (const charge of charges) {
        expect(Number(charge.tax_amount)).toBe(0);
        expect(Number(charge.tax_rate)).toBe(0);
        expect(Number(charge.total_price)).toBe(Number(charge.net_amount));
      }
    }, 60000);
  });

  describe('internal-tax clients keep the tax quoted to the customer', () => {
    async function internalQuote() {
      // A configured rate that disagrees with the quoted tax: the invoice must
      // still show what the customer accepted, not a recomputation.
      await setupClientTaxConfiguration(context, { regionCode: 'US-NY', taxPercentage: 10 });
      await setTenantTaxSource('internal');
      await context.db('clients')
        .where({ tenant: context.tenantId, client_id: context.clientId })
        .update({ region_code: 'US-NY', is_tax_exempt: false });

      return createAcceptedQuote([
        {
          description: 'Implementation',
          quantity: 1,
          unit_price: 20000,
          rawUpdates: { net_amount: 20000, tax_amount: 999, tax_rate: 5, total_price: 20999 },
        },
      ]);
    }

    it('converted invoice carries the quote per-row tax verbatim', async () => {
      const { quote } = await internalQuote();

      const result = await context.db.transaction((trx) =>
        convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      const charge = charges[0];

      expect(header.tax_source).toBe('internal');
      expect(Number(charge.tax_amount)).toBe(999);
      expect(Number(charge.tax_rate)).toBe(5);
      expect(Number(charge.total_price)).toBe(20999);
      expect(Number(header.tax)).toBe(999);
      expect(Number(header.subtotal)).toBe(20000);
      expect(Number(header.total_amount)).toBe(20999);
    }, 60000);

    it('the workflow-worker conversion path carries it the same way', async () => {
      const { quote } = await internalQuote();

      const result = await context.db.transaction((trx) =>
        runtimeConvertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      const charge = charges[0];

      expect(header.tax_source).toBe('internal');
      expect(Number(charge.tax_amount)).toBe(999);
      expect(Number(charge.tax_rate)).toBe(5);
      expect(Number(charge.total_price)).toBe(20999);
      expect(Number(header.tax)).toBe(999);
      expect(Number(header.total_amount)).toBe(20999);
    }, 60000);

    it('a quote tax_source of external does not leak onto the invoice', async () => {
      await setTenantTaxSource('internal');
      const { quote } = await createAcceptedQuote([
        {
          description: 'Advisory',
          quantity: 1,
          unit_price: 10000,
          rawUpdates: { net_amount: 10000, tax_amount: 825, tax_rate: 8, total_price: 10825 },
        },
      ]);
      // Quote rows have carried 'external' historically; only the client decides.
      await context.db('quotes')
        .where({ tenant: context.tenantId, quote_id: quote.quote_id })
        .update({ tax_source: 'external' });

      const result = await context.db.transaction((trx) =>
        convertQuoteToDraftInvoice(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const { header, charges } = await readInvoice(result.invoice.invoice_id);
      expect(header.tax_source).toBe('internal');
      expect(Number(charges[0].tax_amount)).toBe(825);
    }, 60000);
  });

  describe('converted contract lines carry the service category', () => {
    async function createCategory(name: string): Promise<string> {
      const categoryId = randomUUID();
      await context.db('service_categories').insert({
        tenant: context.tenantId,
        category_id: categoryId,
        category_name: `${name} ${categoryId.slice(0, 8)}`,
      });
      return categoryId;
    }

    async function recurringQuoteWithCategories() {
      const categoryId = await createCategory('Managed Services');
      const categorizedServiceId = await createTestService(context, {
        billing_method: 'fixed',
        default_rate: 10000,
        service_name: `Categorized support ${randomUUID().slice(0, 8)}`,
        category_id: categoryId,
      });
      const uncategorizedServiceId = await createTestService(context, {
        billing_method: 'fixed',
        default_rate: 5000,
        service_name: `Uncategorized support ${randomUUID().slice(0, 8)}`,
      });

      const { quote } = await createAcceptedQuote([
        {
          description: 'Categorized monitoring',
          unit_price: 10000,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: categorizedServiceId,
        },
        {
          description: 'Uncategorized monitoring',
          unit_price: 5000,
          is_recurring: true,
          billing_frequency: 'monthly',
          service_id: uncategorizedServiceId,
        },
      ]);

      return { quote, categoryId, categorizedServiceId, uncategorizedServiceId };
    }

    async function readLines(contractId: string) {
      const lines = await context.db('contract_lines')
        .where({ tenant: context.tenantId, contract_id: contractId })
        .orderBy('display_order');
      return lines;
    }

    it('contract conversion stamps service_category from the catalog', async () => {
      const { quote, categoryId } = await recurringQuoteWithCategories();

      const result = await context.db.transaction((trx) =>
        convertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const lines = await readLines(result.contract.contract_id);
      expect(lines).toHaveLength(2);
      expect(lines[0].service_category).toBe(categoryId);
      expect(lines[1].service_category).toBeNull();
    }, 60000);

    it('the workflow-worker contract conversion stamps it too', async () => {
      const { quote, categoryId } = await recurringQuoteWithCategories();

      const result = await context.db.transaction((trx) =>
        runtimeConvertQuoteToDraftContract(trx, context.tenantId, quote.quote_id, context.userId)
      );

      const lines = await readLines(result.contract.contract_id);
      expect(lines).toHaveLength(2);
      expect(lines[0].service_category).toBe(categoryId);
      expect(lines[1].service_category).toBeNull();
    }, 60000);
  });
});
