import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../test-utils/billingTestHelpers';

// Pixel-golden layout regression suite for the standard invoice templates
// shipped by the migrations (`standard_invoice_templates`). A fully
// deterministic invoice (fixed names, dates, numbers; recurring + one-time
// items; two client locations so the by-location template renders real bands)
// is pushed through the REAL template pipeline — the same AST evaluation and
// server-side HTML document the PDF print uses — then rasterized in headless
// Chromium at a fixed A4-at-96dpi viewport and compared against checked-in
// baseline PNGs pixel by pixel.
//
// First run (no baseline for a template) WRITES the baseline into
// __baselines__/ and passes; subsequent runs compare with a ~1% differing-
// pixel tolerance. See README.md in this directory for baseline updates and
// the renderer-version brittleness warning. This suite is deliberately NOT in
// tier1.manifest.json — it reviews template changes, it does not gate PRs.
//
// Bindings deliberately left at their fallback/empty state (all documented,
// all deterministic): tenant logo (none uploaded), project name/number (no
// project invoice), and `notes` (the production view model never carries a
// notes field, so the binding always renders its '' fallback).

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let finalizeInvoice: typeof import('@alga-psa/billing/actions/invoiceModification').finalizeInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let browserPoolService: typeof import('@alga-psa/billing/services/browserPoolService').browserPoolService;
let InvoiceModel: typeof import('@alga-psa/billing/models/invoice').default;
let mapDbInvoiceToWasmViewModel: typeof import('@alga-psa/billing/lib/adapters/invoiceAdapters').mapDbInvoiceToWasmViewModel;
let enrichWithGroupedItems: typeof import('@alga-psa/billing/lib/adapters/invoiceAdapters').enrichWithGroupedItems;
let enrichInvoiceViewModelWithLocations: typeof import('@alga-psa/billing/lib/adapters/invoiceAdapters.server').enrichInvoiceViewModelWithLocations;
let fetchTenantParty: typeof import('@alga-psa/billing/lib/adapters/tenantPartyAdapter').fetchTenantParty;
let evaluateTemplateAst: typeof import('@alga-psa/billing/lib/invoice-template-ast/evaluator').evaluateTemplateAst;
let INVOICE_TEMPLATE_BINDING_ALIASES: typeof import('@alga-psa/billing/lib/invoice-template-ast/bindingAliases').INVOICE_TEMPLATE_BINDING_ALIASES;
let renderTemplateAstHtmlDocument: typeof import('@alga-psa/billing/lib/invoice-template-ast/server-render').renderTemplateAstHtmlDocument;

const GOLDEN_USER_ID = 'aaaa1111-2222-4333-8444-555566667777';

function tenantTable(connection: Knex, tenant: string, tableExpression: string) {
  return tenantDb(connection, tenant).table(tableExpression);
}

// Same mock preamble as the journey suite (see
// src/test/integration/journeys/README.md): tenant context pinned to the test
// connection, withAuth short-circuited, and the event-bus publisher replaced
// so finalize/generate never reach Redis.
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
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
  getTenantFromHeaders: vi.fn(() => tenantId ?? null),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: GOLDEN_USER_ID,
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

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 240_000;

// A4 at 96dpi. The PDF print is driven by the template's own print settings;
// this fixed viewport is the stable page-1 proxy the goldens are pinned to.
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;

// A pixel counts as different when any RGBA channel deviates by more than
// this; the suite fails when more than DIFF_RATIO_TOLERANCE of page pixels
// differ. Absorbs antialiasing wobble, still catches layout shifts.
const PIXEL_CHANNEL_THRESHOLD = 12;
const DIFF_RATIO_TOLERANCE = 0.01;

const VISUAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.join(VISUAL_DIR, '__baselines__');
const OUTPUT_DIR = path.join(VISUAL_DIR, '__output__');

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';
const BASE_RATE_CENTS = 25000;

interface PixelCompareResult {
  ok: boolean;
  reason?: string;
  ratio?: number;
  diffPng?: Buffer;
}

function comparePngs(baselineBuf: Buffer, actualBuf: Buffer): PixelCompareResult {
  const baseline = PNG.sync.read(baselineBuf);
  const actual = PNG.sync.read(actualBuf);
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      ok: false,
      reason: `size mismatch: baseline ${baseline.width}x${baseline.height} vs actual ${actual.width}x${actual.height}`,
    };
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const total = baseline.width * baseline.height;
  let differing = 0;

  for (let i = 0; i < total * 4; i += 4) {
    let pixelDiffers = false;
    for (let c = 0; c < 4; c += 1) {
      if (Math.abs(baseline.data[i + c] - actual.data[i + c]) > PIXEL_CHANNEL_THRESHOLD) {
        pixelDiffers = true;
        break;
      }
    }
    if (pixelDiffers) {
      differing += 1;
      diff.data[i] = 255;
      diff.data[i + 1] = 0;
      diff.data[i + 2] = 0;
      diff.data[i + 3] = 255;
    } else {
      // Faded baseline as context around the red diff pixels.
      diff.data[i] = 255 - Math.trunc((255 - baseline.data[i]) / 4);
      diff.data[i + 1] = 255 - Math.trunc((255 - baseline.data[i + 1]) / 4);
      diff.data[i + 2] = 255 - Math.trunc((255 - baseline.data[i + 2]) / 4);
      diff.data[i + 3] = 255;
    }
  }

  const ratio = differing / total;
  if (ratio > DIFF_RATIO_TOLERANCE) {
    return {
      ok: false,
      ratio,
      reason: `${(ratio * 100).toFixed(3)}% of pixels differ (tolerance ${(DIFF_RATIO_TOLERANCE * 100).toFixed(1)}%)`,
      diffPng: PNG.sync.write(diff),
    };
  }
  return { ok: true, ratio };
}

async function writeFailureArtifacts(code: string, actualPng: Buffer, diffPng?: Buffer): Promise<string> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, '.gitignore'), '*\n');
  await fs.writeFile(path.join(OUTPUT_DIR, `${code}.actual.png`), actualPng);
  if (diffPng) {
    await fs.writeFile(path.join(OUTPUT_DIR, `${code}.diff.png`), diffPng);
  }
  return OUTPUT_DIR;
}

const describeDb = await describeWithDb();

describeDb('visual goldens: standard invoice templates', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Drops + recreates test_database, migrates, seeds — every run starts from
    // the identical schema and seed state, which is what makes the rendered
    // fixture reproducible.
    db = await createTestDbConnection();
    const tenantRow = await tenantDb(db, '__test_tenant_fixture__')
      .unscoped('tenants', 'test fixture reads the seeded tenant row')
      .first<{ tenant: string }>('tenant');
    if (!tenantRow?.tenant) {
      throw new Error('seeded tenant missing from test_database bootstrap');
    }
    tenantId = tenantRow.tenant;
    setupCommonMocks({ tenantId, userId: GOLDEN_USER_ID, permissionCheck: () => true });

    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ browserPoolService } = await import('@alga-psa/billing/services/browserPoolService'));
    InvoiceModel = (await import('@alga-psa/billing/models/invoice')).default;
    ({ mapDbInvoiceToWasmViewModel, enrichWithGroupedItems } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters'));
    ({ enrichInvoiceViewModelWithLocations } = await import('@alga-psa/billing/lib/adapters/invoiceAdapters.server'));
    ({ fetchTenantParty } = await import('@alga-psa/billing/lib/adapters/tenantPartyAdapter'));
    ({ evaluateTemplateAst } = await import('@alga-psa/billing/lib/invoice-template-ast/evaluator'));
    ({ INVOICE_TEMPLATE_BINDING_ALIASES } = await import('@alga-psa/billing/lib/invoice-template-ast/bindingAliases'));
    ({ renderTemplateAstHtmlDocument } = await import('@alga-psa/billing/lib/invoice-template-ast/server-render'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await browserPoolService?.cleanup().catch(() => undefined);
    await db?.destroy();
  }, HOOK_TIMEOUT);

  it('renders the deterministic invoice identically to the checked-in baselines', async () => {
    // ---- fixed fixture ----------------------------------------------------
    // Every rendered string below is a literal (or derives from one), so the
    // pixels only move when a template or the renderer moves.
    await tenantTable(db, tenantId, 'users').insert({
      tenant: tenantId,
      user_id: GOLDEN_USER_ID,
      username: 'golden-template-renderer',
      email: 'golden-renderer@golden.test',
      hashed_password: 'not-used',
      user_type: 'internal',
      first_name: 'Golden',
      last_name: 'Renderer',
      created_at: db.fn.now(),
    });

    // The issuing MSP: default tenant company, so the tenantClient bindings
    // (name + address) render fixed values.
    const mspClientId = 'bbbb1111-2222-4333-8444-555566667777';
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: mspClientId,
      client_name: 'Golden Peak Managed Services',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: 'bbbb2222-2222-4333-8444-555566667777',
      tenant: tenantId,
      client_id: mspClientId,
      location_name: 'Headquarters',
      address_line1: '500 Vendor Way',
      address_line2: 'Suite 900',
      city: 'Springfield',
      state_province: 'IL',
      postal_code: '62701',
      country_code: 'US',
      country_name: 'United States',
      email: 'billing@goldenpeak.test',
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await tenantTable(db, tenantId, 'tenant_companies').insert({
      tenant: tenantId,
      client_id: mspClientId,
      is_default: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // The billed customer, with TWO locations so the by-location template
    // renders two real bands.
    const clientId = 'cccc1111-2222-4333-8444-555566667777';
    const locationAId = 'cccc2222-2222-4333-8444-555566667777';
    const locationBId = 'cccc3333-2222-4333-8444-555566667777';
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Aurora Bakery Group',
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await tenantTable(db, tenantId, 'client_locations').insert([
      {
        location_id: locationAId,
        tenant: tenantId,
        client_id: clientId,
        location_name: 'Harborside Bakery',
        address_line1: '42 Harbor Lane',
        city: 'Portsmouth',
        state_province: 'NH',
        postal_code: '03801',
        country_code: 'US',
        country_name: 'United States',
        email: 'accounts@aurorabakery.test',
        is_default: true,
        is_billing_address: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
      {
        location_id: locationBId,
        tenant: tenantId,
        client_id: clientId,
        location_name: 'Mill Street Cafe',
        address_line1: '7 Mill Street',
        city: 'Concord',
        state_province: 'NH',
        postal_code: '03301',
        country_code: 'US',
        country_name: 'United States',
        email: 'cafe@aurorabakery.test',
        is_default: false,
        is_billing_address: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      },
    ]);

    const contextLike = { db, tenantId, clientId } as const;
    await ensureDefaultBillingSettings(contextLike as any);
    await ensureClientPlanBundlesTable(contextLike as any);
    await setupClientTaxConfiguration(contextLike as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875,
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const januaryCycleId = 'dddd1111-2222-4333-8444-555566667777';
    await tenantTable(db, tenantId, 'client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const serviceId = await createTestService(contextLike as any, {
      service_name: 'Managed Support Retainer',
      billing_method: 'fixed',
      default_rate: BASE_RATE_CENTS,
      unit_of_measure: 'month',
      tax_region: 'US-NY',
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const line = await createFixedPlanAssignment(contextLike as any, serviceId, {
      planName: 'Golden Support Plan',
      billingFrequency: 'monthly',
      baseRateCents: BASE_RATE_CENTS,
      startDate: DECEMBER_START,
      endDate: null,
      billingTiming: 'arrears',
      clientId,
      enableProration: false,
    });

    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: line.contractLineId,
        sourceRunPrefix: 'visual-golden',
      });
    });

    // ---- real generation + finalization -----------------------------------
    const generated = await generateInvoice(januaryCycleId);
    expect(generated?.invoice_id, JSON.stringify(generated)).toBeDefined();
    const invoiceId = generated!.invoice_id;
    const finalizeResult = await finalizeInvoice(invoiceId);
    expect(finalizeResult, JSON.stringify(finalizeResult)).toEqual({ success: true });

    // ---- deterministic normalization --------------------------------------
    // The generated invoice is real; only the fields that would otherwise
    // depend on "now" (issue/due dates, invoice number sequence) are pinned,
    // the recurring charge gets a fixed description + location, and one fixed
    // manual charge is added so the one-time bindings/groups render content.
    const recurringCharge = await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(recurringCharge, 'generated recurring charge').toBeTruthy();

    await tenantTable(db, tenantId, 'invoice_charges')
      .where({ tenant: tenantId, item_id: recurringCharge!.item_id })
      .update({
        description: 'Managed Support Retainer — January 2025',
        location_id: locationAId,
      });

    const ONETIME_NET_CENTS = 15000;
    const ONETIME_TAX_CENTS = 1331; // 8.875% of 15000, fixed by hand
    await tenantTable(db, tenantId, 'invoice_charges').insert({
      tenant: tenantId,
      item_id: 'eeee1111-2222-4333-8444-555566667777',
      invoice_id: invoiceId,
      service_id: null,
      description: 'One-time onboarding & data migration',
      quantity: 1,
      unit_price: ONETIME_NET_CENTS,
      total_price: ONETIME_NET_CENTS,
      tax_region: 'US-NY',
      tax_rate: 8.875,
      tax_amount: ONETIME_TAX_CENTS,
      net_amount: ONETIME_NET_CENTS,
      is_manual: true,
      is_taxable: true,
      is_discount: false,
      location_id: locationBId,
      created_by: GOLDEN_USER_ID,
      created_at: '2025-02-01T00:00:00Z',
    });

    const invoiceRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .update({
        invoice_number: 'INV-GOLDEN-0001',
        po_number: 'PO-2025-0042',
        invoice_date: '2025-02-01T00:00:00Z',
        due_date: '2025-03-03T00:00:00Z',
        subtotal: Number(invoiceRow!.subtotal) + ONETIME_NET_CENTS,
        tax: Number(invoiceRow!.tax) + ONETIME_TAX_CENTS,
        total_amount: Number(invoiceRow!.total_amount) + ONETIME_NET_CENTS + ONETIME_TAX_CENTS,
      });

    // ---- view model through the production adapters ------------------------
    // Same composition as PDFGenerationService.getInvoiceHtml, minus the
    // template auto-swap (each standard template is rendered explicitly).
    const dbInvoiceData = await InvoiceModel.getFullInvoiceById(db, tenantId, invoiceId);
    const tenantParty = await fetchTenantParty(db, tenantId);
    const enrichedData = tenantParty
      ? {
          ...dbInvoiceData,
          tenantClient: {
            name: tenantParty.name,
            address: tenantParty.address,
            logoUrl: tenantParty.logo_url,
          },
        }
      : dbInvoiceData;
    const viewModel = mapDbInvoiceToWasmViewModel(enrichedData);
    expect(viewModel, 'invoice view model').toBeTruthy();

    // getInvoiceCharges has no ORDER BY, so heap order decides item order.
    // Pin it before groups are derived: sort by description (the two items
    // have distinct fixed descriptions), then rebuild the derived groupings.
    viewModel!.items.sort((a, b) => a.description.localeCompare(b.description, 'en'));
    enrichWithGroupedItems(viewModel!);
    await enrichInvoiceViewModelWithLocations(db, tenantId, viewModel!, invoiceId);

    // ---- templates under test: whatever the migrations shipped -------------
    const templates = await InvoiceModel.getStandardTemplates(db);
    const codes = templates
      .map((t: any) => String(t.standard_invoice_template_code))
      .sort();
    expect(codes).toEqual(
      expect.arrayContaining([
        'standard-default',
        'standard-detailed',
        'standard-grouped',
        'standard-invoice-by-location',
      ]),
    );

    await fs.mkdir(BASELINE_DIR, { recursive: true });

    // ---- rasterize + compare ----------------------------------------------
    const generatedBaselines: string[] = [];
    const failures: string[] = [];

    const browser = await browserPoolService.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: PAGE_WIDTH, height: PAGE_HEIGHT, deviceScaleFactor: 1 });
      await page.emulateMediaType('print');

      for (const code of codes) {
        const template = templates.find(
          (t: any) => String(t.standard_invoice_template_code) === code,
        )!;
        const evaluation = evaluateTemplateAst(
          template.templateAst as any,
          viewModel as unknown as Record<string, unknown>,
          { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES },
        );
        const html = await renderTemplateAstHtmlDocument(template.templateAst as any, evaluation, {
          title: 'Invoice',
          knex: db,
        });

        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve());
        const actualPng = Buffer.from(
          await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT },
          }),
        );

        const baselinePath = path.join(BASELINE_DIR, `${code}.png`);
        const baselineBuf = await fs.readFile(baselinePath).catch(() => null);
        if (!baselineBuf) {
          await fs.writeFile(baselinePath, actualPng);
          generatedBaselines.push(code);
          continue;
        }

        const result = comparePngs(baselineBuf, actualPng);
        if (!result.ok) {
          const outputDir = await writeFailureArtifacts(code, actualPng, result.diffPng);
          failures.push(`${code}: ${result.reason} (actual/diff written to ${outputDir})`);
        }
      }
    } finally {
      await page.close().catch(() => undefined);
      await browserPoolService.releaseBrowser(browser).catch(() => undefined);
    }

    if (generatedBaselines.length > 0) {
      console.info(
        `[invoiceTemplateGolden] generated baselines (commit them): ${generatedBaselines.join(', ')}`,
      );
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, HOOK_TIMEOUT);
});
