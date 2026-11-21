/**
 * alga-2026-0002902: every quote line was created taxable at the client's
 * default rate, so services with `tax_rate_id IS NULL` — non-taxable
 * everywhere else in the product — inflated quote totals with phantom tax.
 * Quote lines now read the service's tax configuration the way manual invoice
 * charges do, and an explicit caller choice still wins.
 */
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

// BaseService (used by QuoteService) imports createTenantKnex from the db
// package's own tenant module, so point that at the test connection too.
vi.mock('../../../../../../packages/db/src/lib/tenant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../packages/db/src/lib/tenant')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({
      knex: mockedTenantConnection.db,
      tenant: mockedTenantConnection.tenant,
    })),
  };
});

import { TestContext } from '../../../../../test-utils/testContext';
import { createTestService, setupClientTaxConfiguration } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import { QuoteService } from '@/lib/api/services/QuoteService';
import { createQuoteItemSchema, updateQuoteItemSchema } from '@/lib/api/schemas/quoteSchemas';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

const REGION = 'US-MN';
const TAX_PERCENTAGE = 6.875;
const UNIT_PRICE = 25000;
/** 25000 * 6.875% = 1718.75, ceiled to the cent by the quote tax engine. */
const EXPECTED_TAX = Math.ceil((UNIT_PRICE * TAX_PERCENTAGE) / 100);

describe('Quote item tax derivation from the service catalog', () => {
  let context: TestContext;
  let regionTaxRateId: string;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 180000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;

    // Seeds the region, its rate and the client default — the exact
    // configuration that used to tax every quote line at "7%". It has to run
    // before the client's region_code is set: clients.(tenant, region_code) is
    // a composite FK onto tax_regions.
    regionTaxRateId = await setupClientTaxConfiguration(context, {
      regionCode: REGION,
      regionName: 'Minnesota',
      taxPercentage: TAX_PERCENTAGE,
    });
    await context.db('clients')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ region_code: REGION, is_tax_exempt: false });
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  async function createQuote(title: string) {
    return Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title,
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-04-13T00:00:00.000Z',
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
    });
  }

  /** `tax_rate_id` defaults to null, i.e. the non-taxable service of the ticket. */
  async function createService(serviceName: string, taxRateId: string | null = null) {
    return createTestService(context, {
      service_name: serviceName,
      billing_method: 'fixed',
      default_rate: UNIT_PRICE,
      unit_of_measure: 'site',
      tax_rate_id: taxRateId,
    });
  }

  async function addItem(quoteId: string, serviceId: string | null, overrides: Record<string, unknown> = {}) {
    return QuoteItem.create(context.db, context.tenantId, {
      quote_id: quoteId,
      service_id: serviceId,
      description: 'Quoted line',
      quantity: 1,
      unit_price: UNIT_PRICE,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      created_by: context.userId,
      ...overrides,
    } as any);
  }

  const storedItem = async (quoteItemId: string) =>
    context.db('quote_items').where({ tenant: context.tenantId, quote_item_id: quoteItemId }).first();

  const storedQuote = async (quoteId: string) =>
    context.db('quotes').where({ tenant: context.tenantId, quote_id: quoteId }).first();

  it('a service with no tax rate yields a non-taxable line with zero tax', async () => {
    const quote = await createQuote('No-rate service quote');
    const serviceId = await createService('Project Management');

    const item = await addItem(quote.quote_id, serviceId);

    expect(item.is_taxable).toBe(false);
    expect(item.tax_amount).toBe(0);

    const row = await storedItem(item.quote_item_id);
    expect(row.is_taxable).toBe(false);
    expect(Number(row.tax_amount)).toBe(0);
    expect(Number(row.tax_rate)).toBe(0);

    const totals = await storedQuote(quote.quote_id);
    expect(Number(totals.subtotal)).toBe(UNIT_PRICE);
    expect(Number(totals.tax)).toBe(0);
    expect(Number(totals.total_amount)).toBe(UNIT_PRICE);
  });

  it('a service with a tax rate yields a taxable line in that rate region', async () => {
    const quote = await createQuote('Rated service quote');
    const serviceId = await createService('Managed Firewall', regionTaxRateId);

    const item = await addItem(quote.quote_id, serviceId);

    expect(item.is_taxable).toBe(true);
    expect(item.tax_region).toBe(REGION);
    expect(item.tax_amount).toBe(EXPECTED_TAX);
    // The stored rate is the rate charged, not a rounded 7.
    expect(item.tax_rate).toBe(TAX_PERCENTAGE);

    const totals = await storedQuote(quote.quote_id);
    expect(Number(totals.tax)).toBe(EXPECTED_TAX);
    expect(Number(totals.total_amount)).toBe(UNIT_PRICE + EXPECTED_TAX);
  });

  it('an explicit caller choice wins over the service configuration', async () => {
    const quote = await createQuote('Explicit choice quote');
    const noRateServiceId = await createService('Project Management');
    const ratedServiceId = await createService('Managed Firewall', regionTaxRateId);

    const forcedTaxable = await addItem(quote.quote_id, noRateServiceId, { is_taxable: true });
    expect(forcedTaxable.is_taxable).toBe(true);
    // No rate to inherit a region from, so the client's region still applies.
    expect(forcedTaxable.tax_region).toBe(REGION);
    expect(forcedTaxable.tax_amount).toBe(EXPECTED_TAX);

    const forcedExempt = await addItem(quote.quote_id, ratedServiceId, { is_taxable: false });
    expect(forcedExempt.is_taxable).toBe(false);
    expect(forcedExempt.tax_amount).toBe(0);

    const totals = await storedQuote(quote.quote_id);
    expect(Number(totals.subtotal)).toBe(UNIT_PRICE * 2);
    expect(Number(totals.tax)).toBe(EXPECTED_TAX);
  });

  it('a custom line with no catalog identity stays taxable', async () => {
    const quote = await createQuote('Custom line quote');
    const item = await addItem(quote.quote_id, null, { description: 'Custom onboarding' });

    expect(item.is_taxable).toBe(true);
    expect(item.tax_amount).toBe(EXPECTED_TAX);
  });

  it('changing the catalog selection re-derives the tax treatment', async () => {
    const quote = await createQuote('Reselect quote');
    const ratedServiceId = await createService('Managed Firewall', regionTaxRateId);
    const noRateServiceId = await createService('Project Management');

    const item = await addItem(quote.quote_id, ratedServiceId);
    expect(item.is_taxable).toBe(true);

    const reselected = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      service_id: noRateServiceId,
    });
    expect(reselected.is_taxable).toBe(false);
    expect(reselected.tax_amount).toBe(0);
    expect(Number((await storedQuote(quote.quote_id)).tax)).toBe(0);

    // Back to the rated service, and an explicit choice in the same update wins.
    const backToRated = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      service_id: ratedServiceId,
    });
    expect(backToRated.is_taxable).toBe(true);
    expect(backToRated.tax_region).toBe(REGION);

    const overridden = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      service_id: noRateServiceId,
      is_taxable: true,
    });
    expect(overridden.is_taxable).toBe(true);
    expect(overridden.tax_amount).toBe(EXPECTED_TAX);
  });

  it('an ordinary edit leaves the stored tax treatment alone', async () => {
    const quote = await createQuote('Ordinary edit quote');
    const serviceId = await createService('Project Management');
    const item = await addItem(quote.quote_id, serviceId);
    expect(item.is_taxable).toBe(false);

    const edited = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      description: 'Project Management - phase 2',
      quantity: 2,
    });
    expect(edited.is_taxable).toBe(false);
    expect(edited.tax_amount).toBe(0);
  });

  it('copy flows preserve the source line tax treatment verbatim', async () => {
    const source = await createQuote('Copy source');
    const noRateServiceId = await createService('Project Management');
    const ratedServiceId = await createService('Managed Firewall', regionTaxRateId);
    // A line the operator deliberately made taxable despite the service having
    // no rate must survive duplication unchanged.
    await addItem(source.quote_id, noRateServiceId, { is_taxable: true });
    await addItem(source.quote_id, ratedServiceId, { is_taxable: false });

    const sourceItems = await QuoteItem.listByQuoteId(context.db, context.tenantId, source.quote_id);
    const copy = await createQuote('Copy target');
    for (const sourceItem of sourceItems) {
      await QuoteItem.create(context.db, context.tenantId, {
        quote_id: copy.quote_id,
        service_id: sourceItem.service_id ?? null,
        description: sourceItem.description,
        quantity: sourceItem.quantity,
        unit_price: sourceItem.unit_price,
        display_order: sourceItem.display_order,
        is_optional: sourceItem.is_optional,
        is_selected: sourceItem.is_selected,
        is_recurring: sourceItem.is_recurring,
        is_taxable: sourceItem.is_taxable,
        tax_region: sourceItem.tax_region ?? null,
        created_by: context.userId,
      } as any);
    }

    const copied = await QuoteItem.listByQuoteId(context.db, context.tenantId, copy.quote_id);
    expect(copied.map((row) => row.is_taxable)).toEqual(sourceItems.map((row) => row.is_taxable));
    expect(copied.map((row) => row.tax_amount)).toEqual(sourceItems.map((row) => row.tax_amount));
  });

  // The REST seam: the route parses the body with these schemas and hands the
  // result to QuoteService, so parsing real JSON here covers "is_taxable was
  // never sent" exactly as a third-party caller produces it.
  it('POST /quotes/{id}/items without is_taxable leaves a no-rate service untaxed, and PUT re-enables it', async () => {
    const service = new QuoteService();
    const ctx = { userId: context.userId, tenant: context.tenantId, user: { user_id: context.userId } };

    const quote = await createQuote('REST derivation quote');
    const serviceId = await createService('Project Management');

    const createBody = JSON.parse(JSON.stringify({
      service_id: serviceId,
      description: 'Project Management',
      quantity: 1,
      unit_price: UNIT_PRICE,
    }));
    const created = await service.addItem(quote.quote_id, createQuoteItemSchema.parse(createBody), ctx);

    expect(created.is_taxable).toBe(false);
    expect(created.tax_amount).toBe(0);
    expect(Number((await storedQuote(quote.quote_id)).tax)).toBe(0);

    const updateBody = JSON.parse(JSON.stringify({ is_taxable: true }));
    const updated = await service.updateItem(
      quote.quote_id,
      created.quote_item_id,
      updateQuoteItemSchema.parse(updateBody),
      ctx,
    );

    expect(updated.is_taxable).toBe(true);
    expect(updated.tax_amount).toBe(EXPECTED_TAX);
    expect(Number((await storedQuote(quote.quote_id)).tax)).toBe(EXPECTED_TAX);
  });

  it('quote totals exclude tax for the non-taxable rows of a mixed quote', async () => {
    const quote = await createQuote('Mixed quote');
    const noRateServiceId = await createService('Project Management');
    const ratedServiceId = await createService('Managed Firewall', regionTaxRateId);

    await addItem(quote.quote_id, noRateServiceId);
    await addItem(quote.quote_id, noRateServiceId);
    await addItem(quote.quote_id, ratedServiceId);

    const totals = await storedQuote(quote.quote_id);
    expect(Number(totals.subtotal)).toBe(UNIT_PRICE * 3);
    expect(Number(totals.tax)).toBe(EXPECTED_TAX);
    expect(Number(totals.total_amount)).toBe(UNIT_PRICE * 3 + EXPECTED_TAX);
  });
});
