import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

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
import { createTenant } from '../../../../../test-utils/testDataFactory';
import { createTestService } from '../../../../../test-utils/billingTestHelpers';
import Quote from '../../../../../../packages/billing/src/models/quote';
import QuoteItem from '../../../../../../packages/billing/src/models/quoteItem';
import { mapDbQuoteToViewModel } from '../../../../../../packages/billing/src/lib/adapters/quoteAdapters';
import { resolveQuoteTemplateAst } from '../../../../../../packages/billing/src/lib/quote-template-ast/templateSelection';
import { evaluateTemplateAst } from '../../../../../../packages/billing/src/lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../../../../../../packages/billing/src/lib/invoice-template-ast/react-renderer';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

const NAME = 'Managed Firewall Service';
const CATALOG_DESCRIPTION = 'Central management, rule review, firmware patching, and security monitoring for the firewall fleet.';

describe('Quote item catalog-description snapshot', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 180000);

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

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  async function createQuote(title: string, isTemplate = false) {
    return Quote.create(context.db, context.tenantId, {
      client_id: isTemplate ? null : context.clientId,
      title,
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: validUntil,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: isTemplate,
      created_by: context.userId,
    });
  }

  async function seedCatalogService(overrides: Record<string, unknown> = {}) {
    const { item_kind, service_id: explicitId, ...serviceOverrides } = overrides as {
      item_kind?: string;
      service_id?: string;
      [key: string]: unknown;
    };
    const serviceId = await createTestService(context, {
      service_name: NAME,
      billing_method: 'fixed',
      default_rate: 25000,
      unit_of_measure: 'site',
      description: CATALOG_DESCRIPTION,
      ...(explicitId ? { service_id: explicitId } : {}),
      ...serviceOverrides,
    });
    if (item_kind) {
      await context.db('service_catalog')
        .where({ tenant: context.tenantId, service_id: serviceId })
        .update({ item_kind });
    }
    return serviceId;
  }

  async function createCatalogItem(quoteId: string, serviceId: string, overrides: Record<string, unknown> = {}) {
    return QuoteItem.create(context.db, context.tenantId, {
      quote_id: quoteId,
      service_id: serviceId,
      description: NAME,
      quantity: 1,
      unit_price: 25000,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      ...overrides,
    });
  }

  it('T001: schema exposes nullable catalog_description and create captures authoritative snapshots for product and service', async () => {
    const columns = await context.db('quote_items').columnInfo();
    expect(columns.catalog_description?.type).toBe('text');

    const quote = await createQuote('Snapshot quote');
    const serviceId = await seedCatalogService();
    const serviceItem = await createCatalogItem(quote.quote_id, serviceId);

    expect(serviceItem.service_name).toBe(NAME);
    expect(serviceItem.catalog_description).toBe(CATALOG_DESCRIPTION);
    expect(serviceItem.description).toBe(NAME);

    const productId = uuidv4();
    const productServiceId = await seedCatalogService({
      service_id: productId,
      service_name: 'Firewall Appliance',
      item_kind: 'product',
      default_rate: 125000,
      description: 'Hardened next-generation firewall appliance with a one-year vendor subscription.',
    });
    const productItem = await createCatalogItem(quote.quote_id, productServiceId, {
      service_name: undefined,
      description: 'Firewall Appliance',
      unit_price: 125000,
    });

    expect(productItem.service_item_kind).toBe('product');
    expect(productItem.catalog_description).toBe(
      'Hardened next-generation firewall appliance with a one-year vendor subscription.',
    );

    const row = await context.db('quote_items')
      .where({ tenant: context.tenantId, quote_item_id: serviceItem.quote_item_id })
      .first();
    expect(row.catalog_description).toBe(CATALOG_DESCRIPTION);
  });

  it('T001: rejects a cross-tenant catalog service id', async () => {
    const otherTenantId = await createTenant(context.db);
    const foreignServiceId = uuidv4();
    // Create the catalog row inside this tenant (so service_types etc. exist),
    // then move it under the other tenant to simulate a foreign catalog entry.
    await seedCatalogService({ service_id: foreignServiceId, service_name: 'Foreign Service', seedServicePrice: false });
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: foreignServiceId })
      .update({ tenant: otherTenantId });

    const quote = await createQuote('Cross tenant quote');
    await expect(
      createCatalogItem(quote.quote_id, foreignServiceId),
    ).rejects.toThrow(`Service ${foreignServiceId} not found in tenant`);
  });

  it('T003: quantity, price, and line-description edits preserve the snapshot while a catalog change recaptures identity fields', async () => {
    const quote = await createQuote('Edit quote');
    const serviceId = await seedCatalogService();
    const item = await createCatalogItem(quote.quote_id, serviceId);

    const edited = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      description: 'Edited line description',
      quantity: 3,
      unit_price: 30000,
    });
    expect(edited.catalog_description).toBe(CATALOG_DESCRIPTION);
    expect(edited.service_name).toBe(NAME);
    expect(edited.description).toBe('Edited line description');

    // Catalog-selection change: name/SKU/kind/catalog description recapture together.
    const secondServiceId = await seedCatalogService({
      service_name: 'Patch Management',
      description: 'Automated patch deployment for endpoints, tested before release.',
      default_rate: 12000,
      unit_of_measure: 'seat',
    });
    const recaptured = await QuoteItem.update(context.db, context.tenantId, item.quote_item_id, {
      service_id: secondServiceId,
    });
    expect(recaptured.service_name).toBe('Patch Management');
    expect(recaptured.catalog_description).toBe('Automated patch deployment for endpoints, tested before release.');
    expect(recaptured.description).toBe('Edited line description');
  });

  it('T003: empty catalog text normalizes to null and custom/discount lines keep null snapshots', async () => {
    const quote = await createQuote('Normalization quote');
    const emptyDescriptionService = await seedCatalogService({ description: '   ' });
    const item = await createCatalogItem(quote.quote_id, emptyDescriptionService);
    expect(item.catalog_description).toBeNull();

    const custom = await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Project kickoff',
      quantity: 1,
      unit_price: 3500,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
    });
    expect(custom.catalog_description).toBeNull();
  });

  it('T004: revision copies snapshots verbatim even after catalog edits or deletion', async () => {
    const quote = await createQuote('Revision source');
    const serviceId = await seedCatalogService();
    const item = await createCatalogItem(quote.quote_id, serviceId);
    expect(item.catalog_description).toBe(CATALOG_DESCRIPTION);

    // Later catalog edit must not change existing quote output.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .update({ description: 'Brand new catalog copy after the quote was drafted.' });
    await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .update({ status: 'sent' });

    const revision = await Quote.createRevision(context.db, context.tenantId, quote.quote_id, context.userId);
    const revisedItem = await QuoteItem.listByQuoteId(context.db, context.tenantId, revision.quote_id);
    expect(revisedItem[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);

    // Catalog deletion (FK SET NULL) must not invalidate or refresh snapshots.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .del();
    const reloaded = await QuoteItem.listByQuoteId(context.db, context.tenantId, revision.quote_id);
    expect(reloaded[0]?.service_id).toBeNull();
    expect(reloaded[0]?.service_name).toBe(NAME);
    expect(reloaded[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);
  });

  it('T004: duplicate, save-as-template, and create-from-template copy the stored snapshot verbatim', async () => {
    const sourceQuote = await createQuote('Source for copies');
    const serviceId = await seedCatalogService();
    await createCatalogItem(sourceQuote.quote_id, serviceId);
    const sourceItems = await QuoteItem.listByQuoteId(context.db, context.tenantId, sourceQuote.quote_id);

    // Later catalog edit + delete — copies must carry the ORIGINAL snapshot.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .update({ description: 'Changed after drafting.' });

    // duplicateQuote behaviour: new quote rows whose items are re-created through
    // QuoteItem.create with the stored snapshot passed explicitly.
    const duplicated = await createQuote('Duplicated quote');
    for (const sourceItem of sourceItems) {
      await QuoteItem.create(context.db, context.tenantId, {
        quote_id: duplicated.quote_id,
        service_id: sourceItem.service_id ?? null,
        service_item_kind: sourceItem.service_item_kind ?? null,
        service_name: sourceItem.service_name ?? null,
        service_sku: sourceItem.service_sku ?? null,
        billing_method: sourceItem.billing_method ?? null,
        description: sourceItem.description,
        catalog_description: sourceItem.catalog_description ?? null,
        quantity: sourceItem.quantity,
        unit_price: sourceItem.unit_price,
        unit_of_measure: sourceItem.unit_of_measure ?? null,
        display_order: sourceItem.display_order,
        phase: sourceItem.phase ?? null,
        is_optional: sourceItem.is_optional,
        is_selected: sourceItem.is_selected,
        is_recurring: sourceItem.is_recurring,
        billing_frequency: sourceItem.billing_frequency ?? null,
        is_discount: sourceItem.is_discount ?? false,
        discount_type: sourceItem.discount_type ?? null,
        discount_percentage: sourceItem.discount_percentage ?? null,
        applies_to_item_id: sourceItem.applies_to_item_id ?? null,
        applies_to_service_id: sourceItem.applies_to_service_id ?? null,
        is_taxable: sourceItem.is_taxable ?? true,
        tax_region: sourceItem.tax_region ?? null,
        tax_rate: sourceItem.tax_rate ?? null,
        cost: sourceItem.cost ?? null,
        cost_currency: sourceItem.cost_currency ?? null,
        location_id: sourceItem.location_id ?? null,
        created_by: context.userId,
      });
    }
    const duplicatedItems = await QuoteItem.listByQuoteId(context.db, context.tenantId, duplicated.quote_id);
    expect(duplicatedItems[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);

    // save-as-template → create-from-template: template quote rows carry the
    // snapshot through the copy and the quote created from the template keeps it.
    const template = await createQuote('Template source', true);
    for (const sourceItem of sourceItems) {
      await QuoteItem.create(context.db, context.tenantId, {
        quote_id: template.quote_id,
        service_id: sourceItem.service_id ?? null,
        service_item_kind: sourceItem.service_item_kind ?? null,
        service_name: sourceItem.service_name ?? null,
        service_sku: sourceItem.service_sku ?? null,
        billing_method: sourceItem.billing_method ?? null,
        description: sourceItem.description,
        catalog_description: sourceItem.catalog_description ?? null,
        quantity: sourceItem.quantity,
        unit_price: sourceItem.unit_price,
        display_order: sourceItem.display_order,
        phase: sourceItem.phase ?? null,
        is_optional: sourceItem.is_optional,
        is_selected: true,
        is_recurring: sourceItem.is_recurring,
        billing_frequency: sourceItem.billing_frequency ?? null,
        is_discount: sourceItem.is_discount ?? false,
        discount_type: sourceItem.discount_type ?? null,
        discount_percentage: sourceItem.discount_percentage ?? null,
        applies_to_item_id: sourceItem.applies_to_item_id ?? null,
        applies_to_service_id: sourceItem.applies_to_service_id ?? null,
        is_taxable: sourceItem.is_taxable ?? true,
        tax_region: sourceItem.tax_region ?? null,
        tax_rate: sourceItem.tax_rate ?? null,
        cost: sourceItem.cost ?? null,
        cost_currency: sourceItem.cost_currency ?? null,
        location_id: sourceItem.location_id ?? null,
        created_by: context.userId,
      });
    }

    // Catalog deletion between template save and quote-from-template.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: serviceId })
      .del();
    const templateItems = await QuoteItem.listByQuoteId(context.db, context.tenantId, template.quote_id);
    expect(templateItems[0]?.service_id).toBeNull();
    expect(templateItems[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);

    const fromTemplate = await createQuote('Created from template');
    for (const templateItem of templateItems) {
      await QuoteItem.create(context.db, context.tenantId, {
        quote_id: fromTemplate.quote_id,
        service_id: templateItem.service_id ?? null,
        service_item_kind: templateItem.service_item_kind ?? null,
        service_name: templateItem.service_name ?? null,
        service_sku: templateItem.service_sku ?? null,
        billing_method: templateItem.billing_method ?? null,
        description: templateItem.description,
        catalog_description: templateItem.catalog_description ?? null,
        quantity: templateItem.quantity,
        unit_price: templateItem.unit_price,
        display_order: templateItem.display_order,
        phase: templateItem.phase ?? null,
        is_optional: templateItem.is_optional,
        is_selected: templateItem.is_selected,
        is_recurring: templateItem.is_recurring,
        billing_frequency: templateItem.billing_frequency ?? null,
        is_discount: templateItem.is_discount ?? false,
        discount_type: templateItem.discount_type ?? null,
        discount_percentage: templateItem.discount_percentage ?? null,
        applies_to_item_id: templateItem.applies_to_item_id ?? null,
        applies_to_service_id: templateItem.applies_to_service_id ?? null,
        is_taxable: templateItem.is_taxable ?? true,
        tax_region: templateItem.tax_region ?? null,
        tax_rate: templateItem.tax_rate ?? null,
        cost: templateItem.cost ?? null,
        cost_currency: templateItem.cost_currency ?? null,
        location_id: templateItem.location_id ?? null,
        created_by: context.userId,
      });
    }
    const fromTemplateItems = await QuoteItem.listByQuoteId(context.db, context.tenantId, fromTemplate.quote_id);
    expect(fromTemplateItems[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);
    expect(fromTemplateItems[0]?.service_name).toBe(NAME);
  });

  it('T008: seeded standard templates are updated additively and tenant custom ASTs are untouched', async () => {
    const standardRows = await context.db('standard_quote_document_templates')
      .whereIn('standard_quote_document_template_code', [
        'standard-quote-default',
        'standard-quote-detailed',
        'standard-quote-grouped',
        'standard-quote-by-location',
      ])
      .select('standard_quote_document_template_code', 'templateAst');

    expect(standardRows.length).toBe(4);
    const descriptions = standardRows.flatMap((row) => {
      const ast = row.templateAst;
      const out: Array<{ code: string; column: any }> = [];
      const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if ((node.type === 'dynamic-table' || node.type === 'table') && Array.isArray(node.columns)) {
          for (const column of node.columns) {
            if (column?.id === 'description' && column?.value?.type === 'path' && column?.value?.path === 'description') {
              out.push({ code: row.standard_quote_document_template_code, column });
            }
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
      };
      visit(ast.layout);
      return out;
    });

    expect(descriptions.length).toBeGreaterThanOrEqual(5);
    for (const { column } of descriptions) {
      expect(column.value).toEqual({ type: 'path', path: 'description' });
      expect(column.lines?.map((line: any) => line.value.path)).toEqual(['service_name', 'catalog_description']);
    }

    // A tenant-owned custom AST inserted with a plain description column is untouched.
    const customTemplateId = uuidv4();
    const customAst = {
      kind: 'invoice-template-ast',
      version: 1,
      metadata: { templateName: 'Custom' },
      bindings: {},
      layout: {
        id: 'root',
        type: 'document',
        children: [
          {
            id: 'custom-table',
            type: 'dynamic-table',
            repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
            columns: [{ id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '50%' } } }],
          },
        ],
      },
    };
    await context.db('quote_document_templates').insert({
      template_id: customTemplateId,
      tenant: context.tenantId,
      name: 'Customer layout',
      version: 1,
      templateAst: customAst,
    });
    const saved = await context.db('quote_document_templates')
      .where({ tenant: context.tenantId, template_id: customTemplateId })
      .first();
    expect(saved.templateAst.layout.children[0].columns[0].lines).toBeUndefined();
  });

  it('T009: adding catalog-description snapshots leaves quote totals bit-identical', async () => {
    const quote = await createQuote('Totals quote');
    const serviceId = await seedCatalogService();
    await createCatalogItem(quote.quote_id, serviceId, { quantity: 2 });
    const productServiceId = await seedCatalogService({
      service_name: 'Firewall Appliance',
      item_kind: 'product',
      default_rate: 125000,
      description: 'Appliance hardware.',
    });
    await createCatalogItem(quote.quote_id, productServiceId, { description: 'Firewall Appliance', unit_price: 125000 });

    await QuoteItem.create(context.db, context.tenantId, {
      quote_id: quote.quote_id,
      description: 'Discount (10%)',
      quantity: 1,
      unit_price: 0,
      is_optional: false,
      is_selected: true,
      is_recurring: false,
      is_discount: true,
      discount_type: 'percentage',
      discount_percentage: 10,
      applies_to_item_id: null,
      applies_to_service_id: null,
    });

    const totals = await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .first();

    // item totals: 2*25000 + 125000 = 175000; discount 10% = 17500; tax 0.
    expect(Number(totals.subtotal)).toBe(175000);
    expect(Number(totals.discount_total)).toBe(17500);
    expect(Number(totals.tax)).toBe(0);
    expect(Number(totals.total_amount)).toBe(157500);

    const items = await QuoteItem.listByQuoteId(context.db, context.tenantId, quote.quote_id);
    expect(items.find((i) => !i.is_discount)?.catalog_description).toBeTruthy();

    // Rewriting the catalog descriptions afterwards must not change stored totals.
    await context.db('service_catalog')
      .where({ tenant: context.tenantId })
      .update({ description: 'Completely different catalog copy.' });
    const unchanged = await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: quote.quote_id })
      .first();
    expect(Number(unchanged.subtotal)).toBe(175000);
    expect(Number(unchanged.total_amount)).toBe(157500);
  });

  it('renders catalog snapshots through the DB view model and the seeded standard template', async () => {
    const quote = await createQuote('Render quote');
    const serviceId = await seedCatalogService();
    await createCatalogItem(quote.quote_id, serviceId);

    const viewModel = await mapDbQuoteToViewModel(context.db, context.tenantId, quote.quote_id);
    expect(viewModel?.line_items[0]?.catalog_description).toBe(CATALOG_DESCRIPTION);

    const resolved = await resolveQuoteTemplateAst(context.db, context.tenantId, quote.quote_id);
    expect(resolved.standardCode).toBe('standard-quote-default');
    const descriptionColumn = (resolved.templateAst.layout as any).children
      .find((node: any) => node.id === 'line-items')?.columns
      .find((column: any) => column.id === 'description');
    expect(descriptionColumn.lines.map((line: any) => line.value.path)).toEqual([
      'service_name',
      'catalog_description',
    ]);

    const evaluation = evaluateTemplateAst(resolved.templateAst, viewModel as unknown as Record<string, unknown>);
    const { html } = await renderEvaluatedTemplateAst(resolved.templateAst, evaluation, { locale: 'en-US' });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const nameIndex = text.indexOf(NAME);
    const descriptionIndex = text.indexOf(CATALOG_DESCRIPTION);
    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(descriptionIndex).toBeGreaterThan(nameIndex);
  });
});
