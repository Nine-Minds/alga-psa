import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tenantDb } from '@alga-psa/db';
import { getStandardQuoteTemplateAstByCode } from '@alga-psa/billing/lib/quote-template-ast/standardTemplates';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

// P0 journey (docs: journey-first testing pivot): the non-invoice document
// types — QUOTE, SALES ORDER confirmation, and PACKING SLIP — rendered through
// the SAME shared engine the invoice render journey covers
// (createPDFGenerationService → template AST resolution → server-rendered HTML
// → headless Chromium via the shared browser pool → PDF bytes). Nothing in the
// render pipeline is mocked. Per type this pins: real PDF bytes, the
// document's identifying number in the rendered HTML, and one family-specific
// invariant — quote: expiry date + total; sales order: SO number + per-line
// and order totals; packing slip: quantities present and PRICES ABSENT (the
// classic packing-slip bug: a warehouse document leaking sell prices).
//
// Template resolution exercised as shipped: quotes fall back to the standard
// quote template seeded by the migrations (standard_quote_document_templates);
// sales-order documents resolve through the generic document-type registry
// (client override → tenant default → in-code standard AST).
//
// A second quote runs the same pipeline through the GROUPED standard template,
// where the reported cadence bugs live: a discount aimed at a monthly service
// has to print in — and reduce — the Monthly group, and the Description cell
// has to stack the item name over the catalog description.

let db: Knex;
let tenantId: string;
let createPDFGenerationService: typeof import('@alga-psa/billing/services/pdfGenerationService').createPDFGenerationService;
let browserPoolService: typeof import('@alga-psa/billing/services/browserPoolService').browserPoolService;

const journeyUserId = uuidv4();

function tenantTable<Row extends object = Record<string, unknown>>(
  connection: Knex,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(connection, tenant).table<Row>(tableExpression);
}

function tenantRows(connection: Knex): Knex.QueryBuilder<Record<string, unknown>, Record<string, unknown>[]> {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    withTransaction: vi.fn(async (knexOrTrx: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) =>
      callback(knexOrTrx as unknown as Knex.Transaction),
    ),
    requireTenantId: vi.fn(async () => tenantId),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: journeyUserId,
          tenant: tenantId,
          roles: [{ role_name: 'Admin' }],
        } as any,
        { tenant: tenantId },
        ...args,
      ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

// The render path under test never stores or publishes, but the service module
// imports the event-bus publisher at load time — mock the seam so nothing can
// reach for Redis. (Per the journeys README, any assertion against these would
// go through the mock's own mock.calls, never a closure-captured array.)
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 240_000;
const TEST_TIMEOUT = 120_000;

// Per-run identifiers: the journey DB persists across runs and both
// quotes.quote_number and sales_orders.so_number are unique per tenant.
const runTag = uuidv4().slice(0, 8);
const QUOTE_NUMBER = `Q-${runTag}`;
const GROUPED_QUOTE_NUMBER = `QG-${runTag}`;
const SO_NUMBER = `SO-${runTag}`;

let storageBaseDir: string;
let clientId: string;
let quoteId: string;
let groupedQuoteId: string;
let salesOrderId: string;

function expectStructurallyValidPdf(pdfBuffer: Buffer): void {
  expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
  expect(pdfBuffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  expect(pdfBuffer.length).toBeGreaterThan(2048);
  // Structural sanity without a PDF parser (pdf-lib is aliased to empty-module
  // in server/vitest.config.ts): a complete PDF carries a cross-reference
  // pointer and the end-of-file marker.
  const pdfTail = pdfBuffer.subarray(-1024).toString('latin1');
  expect(pdfTail).toContain('startxref');
  expect(pdfTail).toContain('%%EOF');
}

// generatePDF is bytes-only and Chromium embeds subset fonts, so content pins
// sit on the HTML from the same evaluation that feeds the print (the pattern
// the invoice render journey established). Quotes expose that HTML publicly
// (renderQuotePreview); sales-order documents do not, so the test calls the
// service's own getSalesOrderHtml — the exact private method generatePDF
// invokes for salesOrderId — rather than re-deriving the render by hand.
type SalesOrderHtmlSeam = {
  getSalesOrderHtml(options: {
    salesOrderId: string;
    documentType?: 'sales-order' | 'packing-slip' | 'pick-list';
  }): Promise<{ htmlContent: string; templateAst: unknown }>;
};

describe('journey: quote / sales order / packing slip render through the shared PDF engine', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Real LocalStorageProvider config, pointed at a throwaway directory. The
    // storage config caches on first read, so this must be set before any
    // storage-touching code loads (the render path itself never writes files).
    storageBaseDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'document-types-render-journey-'));
    process.env.STORAGE_DEFAULT_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_BASE_PATH = storageBaseDir;

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: journeyUserId, permissionCheck: () => true });
    ({ createPDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService'));
    ({ browserPoolService } = await import('@alga-psa/billing/services/browserPoolService'));

    // --- shared fixture: one client with a billing/default location (the
    // customer party on every document) ---
    clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey DocTypes Client ${runTag}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'HQ',
      address_line1: '9 Document Way',
      city: 'Rendertown',
      state_province: 'NY',
      postal_code: '10002',
      country_code: 'US',
      country_name: 'United States',
      email: `doctypes-${runTag}@journey.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // --- quote fixture: header totals live on the quotes row; two selected
    // one-time items back them ---
    quoteId = uuidv4();
    await tenantTable(db, tenantId, 'quotes').insert({
      tenant: tenantId,
      quote_id: quoteId,
      quote_number: QUOTE_NUMBER,
      client_id: clientId,
      title: 'Managed Services Proposal',
      description: 'Scope: onboarding plus managed workstation support.',
      quote_date: '2026-06-01T00:00:00Z',
      valid_until: '2026-09-15T00:00:00Z',
      status: 'draft',
      subtotal: 125000,
      discount_total: 0,
      tax: 11094,
      total_amount: 136094,
      currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'quote_items').insert([
      {
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: quoteId,
        description: 'Onboarding & Migration',
        quantity: 1,
        unit_price: 100000,
        total_price: 100000,
        tax_amount: 8875,
        net_amount: 100000,
        display_order: 1,
      },
      {
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: quoteId,
        description: 'Managed Workstation Support',
        quantity: 5,
        unit_price: 5000,
        total_price: 25000,
        tax_amount: 2219,
        net_amount: 25000,
        display_order: 2,
      },
    ]);

    // --- sales order fixture: SO lines carry no description column; the
    // Product cell falls back to service_catalog.service_name, and the SKU
    // column reads service_catalog.sku ---
    const contextLike = { db, tenantId, clientId } as const;
    const serverServiceId = await createTestService(contextLike as any, {
      service_name: 'Rack Server R750',
      billing_method: 'fixed',
      default_rate: 250000,
      unit_of_measure: 'each'
    });
    const cableServiceId = await createTestService(contextLike as any, {
      service_name: 'Cat6 Patch Cable',
      billing_method: 'fixed',
      default_rate: 1500,
      unit_of_measure: 'each'
    });
    await tenantTable(db, tenantId, 'service_catalog')
      .where({ tenant: tenantId, service_id: serverServiceId })
      .update({ sku: `R750-${runTag}` });

    salesOrderId = uuidv4();
    await tenantTable(db, tenantId, 'sales_orders').insert({
      tenant: tenantId,
      so_id: salesOrderId,
      so_number: SO_NUMBER,
      client_id: clientId,
      status: 'confirmed',
      order_date: '2026-06-20T00:00:00Z',
      expected_ship_date: '2026-07-05T00:00:00Z',
      currency_code: 'USD',
      client_po_number: `PO-${runTag}`,
      notes: 'Deliver to loading dock B.',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'sales_order_lines').insert([
      {
        tenant: tenantId,
        so_line_id: uuidv4(),
        so_id: salesOrderId,
        service_id: serverServiceId,
        quantity_ordered: 3,
        quantity_fulfilled: 1,
        unit_price: 250000,
        fulfillment_type: 'from_stock',
        created_at: '2026-06-20T00:00:01Z',
      },
      {
        tenant: tenantId,
        so_line_id: uuidv4(),
        so_id: salesOrderId,
        service_id: cableServiceId,
        quantity_ordered: 12,
        quantity_fulfilled: 0,
        unit_price: 1500,
        fulfillment_type: 'drop_ship',
        created_at: '2026-06-20T00:00:02Z',
      },
    ]);

    // --- grouped quote fixture (alga-2026-0002353 / alga-2026-0002354): the
    // customer's shape — two MONTHLY services, a $5 discount aimed at each, and
    // two one-time products. The grouped template prints Monthly and One-time
    // groups with their own totals, and the report was that Monthly ignored the
    // discounts. The second discount is stored is_recurring=false on purpose:
    // that is how rows saved before the cadence fix look, and grouping must
    // follow what a discount targets, not the flags on the discount row.
    const basicSupportServiceId = await createTestService(contextLike as any, {
      service_name: 'Basic Support',
      billing_method: 'fixed',
      default_rate: 2500,
      unit_of_measure: 'month'
    });
    const premiumSupportServiceId = await createTestService(contextLike as any, {
      service_name: 'Premium Support',
      billing_method: 'fixed',
      default_rate: 3500,
      unit_of_measure: 'month'
    });

    groupedQuoteId = uuidv4();
    const basicSupportItemId = uuidv4();
    await tenantTable(db, tenantId, 'quotes').insert({
      tenant: tenantId,
      quote_id: groupedQuoteId,
      quote_number: GROUPED_QUOTE_NUMBER,
      client_id: clientId,
      title: 'Support & Hardware',
      quote_date: '2026-06-01T00:00:00Z',
      valid_until: '2026-09-15T00:00:00Z',
      status: 'draft',
      subtotal: 26900,
      discount_total: 1000,
      tax: 0,
      total_amount: 25900,
      currency_code: 'USD',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'quote_items').insert([
      {
        tenant: tenantId,
        quote_item_id: basicSupportItemId,
        quote_id: groupedQuoteId,
        service_id: basicSupportServiceId,
        service_name: 'Basic Support',
        service_item_kind: 'service',
        description: 'Standard support package',
        quantity: 1,
        unit_price: 2500,
        total_price: 2500,
        tax_amount: 0,
        net_amount: 2500,
        display_order: 1,
        is_recurring: true,
        billing_frequency: 'monthly',
      },
      {
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: groupedQuoteId,
        service_id: premiumSupportServiceId,
        service_name: 'Premium Support',
        service_item_kind: 'service',
        description: 'Priority response package',
        quantity: 1,
        unit_price: 3500,
        total_price: 3500,
        tax_amount: 0,
        net_amount: 3500,
        display_order: 2,
        is_recurring: true,
        billing_frequency: 'monthly',
      },
      {
        // Targets the monthly line by item id.
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: groupedQuoteId,
        description: 'Discount',
        quantity: 1,
        unit_price: 500,
        total_price: 500,
        tax_amount: 0,
        net_amount: 500,
        display_order: 3,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_item_id: basicSupportItemId,
        is_recurring: true,
        billing_frequency: 'monthly',
      },
      {
        // Targets the other monthly line by service id, and carries the
        // pre-fix one-time cadence.
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: groupedQuoteId,
        description: 'Discount',
        quantity: 1,
        unit_price: 500,
        total_price: 500,
        tax_amount: 0,
        net_amount: 500,
        display_order: 4,
        is_discount: true,
        discount_type: 'fixed',
        applies_to_service_id: premiumSupportServiceId,
        is_recurring: false,
      },
      {
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: groupedQuoteId,
        service_name: 'PoE Switch 8-port',
        service_item_kind: 'product',
        description: 'Gigabit, fanless',
        quantity: 1,
        unit_price: 20000,
        total_price: 20000,
        tax_amount: 0,
        net_amount: 20000,
        display_order: 5,
      },
      {
        tenant: tenantId,
        quote_item_id: uuidv4(),
        quote_id: groupedQuoteId,
        service_name: 'Cat6 Patch Cable 2m',
        service_item_kind: 'product',
        description: 'Snagless, blue',
        quantity: 1,
        unit_price: 900,
        total_price: 900,
        tax_amount: 0,
        net_amount: 900,
        display_order: 6,
      },
    ]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await browserPoolService?.cleanup().catch(() => undefined);
    await db?.destroy();
    if (storageBaseDir) {
      await fs.rm(storageBaseDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, HOOK_TIMEOUT);

  it('renders a quote to a real PDF with the quote number, expiry, and total in the output', async () => {
    const pdfService = createPDFGenerationService(tenantId);

    // Real render: standard quote template (migration-seeded catalog fallback)
    // → server-rendered HTML → headless Chromium print via the shared pool.
    // generatePDF({ quoteId }) is exactly what downloadQuotePdf /
    // sendQuoteEmailWithAttachment call.
    const pdfBuffer = await pdfService.generatePDF({ quoteId, userId: journeyUserId });
    expectStructurallyValidPdf(pdfBuffer);

    // Content pins on the HTML from the same template-AST evaluation that
    // feeds the print (renderQuotePreview is the public path quoteActions'
    // renderQuotePreview action uses).
    const preview = await pdfService.renderQuotePreview({ quoteId });
    expect(preview.html).toContain(QUOTE_NUMBER);

    // Family pin: expiry renders (Valid Until, date-formatted en-US/UTC from
    // the timestamptz) and the quotes-row total renders currency-formatted.
    expect(preview.html).toContain('Valid Until');
    expect(preview.html).toContain('9/15/2026');
    expect(preview.html).toContain('$1,360.94');
    // The totals card reads the quotes-row header totals, not a recompute.
    expect(preview.html).toContain('$1,250.00'); // subtotal 125000¢
    expect(preview.html).toContain('$110.94'); // tax 11094¢
  }, TEST_TIMEOUT);

  it('renders the grouped quote with its discounts inside the monthly group', async () => {
    const pdfService = createPDFGenerationService(tenantId);
    const groupedAst = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(groupedAst).not.toBeNull();

    const pdfBuffer = await pdfService.generatePDF({
      quoteId: groupedQuoteId,
      templateAst: groupedAst!,
      userId: journeyUserId,
    });
    expectStructurallyValidPdf(pdfBuffer);

    const preview = await pdfService.renderQuotePreview({
      quoteId: groupedQuoteId,
      templateAst: groupedAst!,
    });

    // The grouped template prints one table per cadence; slice them apart so
    // membership is asserted, not just the presence of a string somewhere.
    const monthlyTable = preview.html.slice(
      preview.html.indexOf('id="monthly-items"'),
      preview.html.indexOf('id="onetime-section-label"')
    );
    const onetimeTable = preview.html.slice(preview.html.indexOf('id="onetime-items"'));

    // alga-2026-0002353: both discounts land in the monthly group — the one
    // aimed by item id and the one-time-flagged one aimed by service id — and
    // print as deductions. Nothing takes them off the one-time group.
    expect(monthlyTable.match(/-\$5\.00/g)).toHaveLength(4); // price + amount, twice
    expect(onetimeTable).not.toContain('-$5.00');
    // Monthly Total $50.00 ($25 + $35 − $5 − $5); one-time keeps $200 + $9.
    expect(preview.html).toContain('<span class="ast-totals-value">$50.00</span>');
    expect(preview.html).toContain('<span class="ast-totals-value">$209.00</span>');

    // alga-2026-0002354: the Description cell stacks the catalog item name over
    // its own description instead of repeating the name.
    expect(monthlyTable).toContain('Basic Support\nStandard support package');
    expect(onetimeTable).toContain('Cat6 Patch Cable 2m\nSnagless, blue');
  }, TEST_TIMEOUT);

  it('renders a sales order confirmation to a real PDF with the SO number and line totals', async () => {
    const pdfService = createPDFGenerationService(tenantId);

    // generatePDF({ salesOrderId }) is exactly what downloadSalesOrderPDF and
    // emailSalesOrderConfirmation call; the template resolves through the
    // generic document-type registry (no override/default seeded → standard).
    const pdfBuffer = await pdfService.generatePDF({
      salesOrderId,
      salesOrderDocumentType: 'sales-order',
      userId: journeyUserId,
    });
    expectStructurallyValidPdf(pdfBuffer);

    const { htmlContent } = await (pdfService as unknown as SalesOrderHtmlSeam)
      .getSalesOrderHtml({ salesOrderId, documentType: 'sales-order' });

    expect(htmlContent).toContain('ORDER CONFIRMATION');
    expect(htmlContent).toContain(SO_NUMBER);
    expect(htmlContent).toContain('Rack Server R750');
    expect(htmlContent).toContain('Cat6 Patch Cable');

    // Family pin: per-line amounts are computed qty × unit price (the lines
    // table stores only unit_price), and the totals card sums them. Phase 1
    // reports the pre-tax total (tax lands on the generated invoice).
    expect(htmlContent).toContain('$2,500.00'); // unit price 250000¢
    expect(htmlContent).toContain('$7,500.00'); // 3 × $2,500.00
    expect(htmlContent).toContain('$180.00'); // 12 × $15.00
    expect(htmlContent).toContain('$7,680.00'); // subtotal + order total
    expect(htmlContent).toContain('Totals shown are pre-tax');
  }, TEST_TIMEOUT);

  it('renders a packing slip with quantities but NO prices from the same sales order', async () => {
    const pdfService = createPDFGenerationService(tenantId);

    const pdfBuffer = await pdfService.generatePDF({
      salesOrderId,
      salesOrderDocumentType: 'packing-slip',
      userId: journeyUserId,
    });
    expectStructurallyValidPdf(pdfBuffer);

    const { htmlContent } = await (pdfService as unknown as SalesOrderHtmlSeam)
      .getSalesOrderHtml({ salesOrderId, documentType: 'packing-slip' });

    expect(htmlContent).toContain('PACKING SLIP');
    expect(htmlContent).toContain(SO_NUMBER);
    // Ship To is the customer party resolved from the client's billing/default
    // location.
    expect(htmlContent).toContain('Ship To');
    expect(htmlContent).toContain(`Journey DocTypes Client ${runTag}`);
    expect(htmlContent).toContain('9 Document Way');

    // Family pin 1: ordered/shipped quantities render as table cells, and the
    // fulfillment source (drop-ship line) is visible to the warehouse.
    expect(htmlContent).toContain('Ordered');
    expect(htmlContent).toContain('Shipped');
    expect(htmlContent).toMatch(/>3</); // server: ordered 3
    expect(htmlContent).toMatch(/>1</); // server: shipped 1
    expect(htmlContent).toMatch(/>12</); // cable: ordered 12
    expect(htmlContent).toContain(`R750-${runTag}`); // SKU column
    expect(htmlContent).toContain('drop_ship');

    // Family pin 2 — the classic packing-slip bug: NO prices anywhere in the
    // box document. Not the amounts the confirmation shows, no price/total
    // labels, and no currency-formatted value at all.
    expect(htmlContent).not.toContain('$2,500.00');
    expect(htmlContent).not.toContain('$7,500.00');
    expect(htmlContent).not.toContain('$180.00');
    expect(htmlContent).not.toContain('$7,680.00');
    expect(htmlContent).not.toContain('Unit Price');
    expect(htmlContent).not.toContain('Subtotal');
    expect(htmlContent).not.toContain('Order Total');
    expect(htmlContent).not.toContain('$');
  }, TEST_TIMEOUT);
});

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }
  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Journey Integration Tenant',
    email: 'journeys@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}
