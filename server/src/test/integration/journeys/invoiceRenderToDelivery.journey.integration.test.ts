import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  createTestService,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
  ensureDefaultBillingSettings,
} from '../../../../test-utils/billingTestHelpers';

// P0 journey (docs: journey-first testing pivot): the rendering leg the money
// journeys stop short of — a finalized invoice goes through the REAL renderer
// (createPDFGenerationService → standard-template AST from the migrations →
// server-rendered HTML → headless Chromium via puppeteer → PDF bytes) and the
// REAL storage path (LocalStorageProvider → external_files row → the
// DOCUMENT_GENERATED workflow event that carries the file↔invoice linkage).
// Nothing in the render/store pipeline is mocked; the only mocked seam is the
// event-bus publisher, replaced with a capture so the linkage payload can be
// asserted instead of disappearing into Redis.
//
// What the code does NOT do (asserted as-is, not aspirationally): invoice PDFs
// never get a `documents`/`document_associations` row — the only DB record is
// the external_files row, and the only invoice linkage is the event payload
// (sourceType/sourceId) plus the invoice-number-derived original_name.

let db: Knex;
let tenantId: string;
let generateInvoice: typeof import('@alga-psa/billing/actions/invoiceGeneration').generateInvoice;
let finalizeInvoice: typeof import('@alga-psa/billing/actions/invoiceModification').finalizeInvoice;
let syncRecurringServicePeriodsForContractLine: typeof import('@alga-psa/billing/actions/recurringServicePeriodSync').syncRecurringServicePeriodsForContractLine;
let createPDFGenerationService: typeof import('@alga-psa/billing/services/pdfGenerationService').createPDFGenerationService;
let browserPoolService: typeof import('@alga-psa/billing/services/browserPoolService').browserPoolService;

const journeyUserId = uuidv4();
type PublishedWorkflowEvent = { eventType: string; payload: Record<string, unknown> };
let publishWorkflowEventMock: ReturnType<typeof vi.fn>;

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

// The one mocked seam: generateAndStore publishes DOCUMENT_GENERATED with the
// file↔invoice linkage and swallows publish failures. Capturing the publish
// turns that fire-and-forget payload into an assertable record.
// The publish call is asserted through the mock's own recorded calls (see
// beforeAll) rather than a closure-captured array: the factory closure and the
// test body do not reliably share module-scope state in this runner.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

const HOOK_TIMEOUT = 240_000;

const DECEMBER_START = '2024-12-01';
const JANUARY_START = '2025-01-01';
const FEBRUARY_START = '2025-02-01';

const BASE_RATE_CENTS = 25000;

let storageBaseDir: string;

describe('journey: invoice render → stored PDF', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    // Real LocalStorageProvider, pointed at a throwaway directory. The storage
    // config caches on first read, so this must be set before the first
    // generateAndStore call.
    storageBaseDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'invoice-render-journey-'));
    process.env.STORAGE_DEFAULT_PROVIDER = 'local';
    process.env.STORAGE_LOCAL_BASE_PATH = storageBaseDir;

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, userId: journeyUserId, permissionCheck: () => true });
    ({ generateInvoice } = await import('@alga-psa/billing/actions/invoiceGeneration'));
    ({ finalizeInvoice } = await import('@alga-psa/billing/actions/invoiceModification'));
    ({ syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync'));
    ({ createPDFGenerationService } = await import('@alga-psa/billing/services/pdfGenerationService'));
    ({ browserPoolService } = await import('@alga-psa/billing/services/browserPoolService'));
    const publishers = await import('@alga-psa/event-bus/publishers');
    publishWorkflowEventMock = vi.mocked(publishers.publishWorkflowEvent) as unknown as ReturnType<typeof vi.fn>;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await browserPoolService?.cleanup().catch(() => undefined);
    await db?.destroy();
    if (storageBaseDir) {
      await fs.rm(storageBaseDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, HOOK_TIMEOUT);

  it('renders a finalized invoice to a real PDF, stores it tenant-scoped, and links it via the generated-document event', async () => {
    // --- the uploader must be a real user: external_files.uploaded_by_id has
    // an FK to users(tenant, user_id) ---
    await tenantTable(db, tenantId, 'users').insert({
      tenant: tenantId,
      user_id: journeyUserId,
      username: `journey-render-${journeyUserId.slice(0, 8)}`,
      email: `journey-render-${journeyUserId.slice(0, 8)}@journey.test`,
      hashed_password: 'not-used',
      user_type: 'internal',
      first_name: 'Journey',
      last_name: 'Renderer',
      created_at: db.fn.now()
    });

    // --- a client with a billing cycle, tax config, and a billing address
    // (same lean setup as the invoice lifecycle journey) ---
    const clientId = uuidv4();
    await tenantTable(db, tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Journey Render Client ${clientId.slice(0, 8)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    await tenantTable(db, tenantId, 'client_locations').insert({
      location_id: uuidv4(),
      tenant: tenantId,
      client_id: clientId,
      location_name: 'Billing',
      address_line1: '1 Render Road',
      city: 'Testville',
      state_province: 'NY',
      postal_code: '10001',
      country_code: 'US',
      country_name: 'United States',
      email: `${clientId.slice(0, 8)}@journey.test`,
      is_default: true,
      is_billing_address: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const contextLike = { db, tenantId, clientId } as const;
    await ensureDefaultBillingSettings(contextLike as any);
    await ensureClientPlanBundlesTable(contextLike as any);
    await setupClientTaxConfiguration(contextLike as any, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'New York Tax',
      startDate: '2024-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const januaryCycleId = uuidv4();
    await tenantTable(db, tenantId, 'client_billing_cycles').insert({
      billing_cycle_id: januaryCycleId,
      tenant: tenantId,
      client_id: clientId,
      billing_cycle: 'monthly',
      effective_date: `${JANUARY_START}T00:00:00Z`,
      period_start_date: `${JANUARY_START}T00:00:00Z`,
      period_end_date: `${FEBRUARY_START}T00:00:00Z`,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    const serviceId = await createTestService(contextLike as any, {
      service_name: 'Journey Render Support',
      billing_method: 'fixed',
      default_rate: BASE_RATE_CENTS,
      unit_of_measure: 'month',
      tax_region: 'US-NY'
    });
    await assignServiceTaxRate(contextLike as any, '*', 'US-NY', { onlyUnset: true });

    const line = await createFixedPlanAssignment(contextLike as any, serviceId, {
      planName: 'Journey Render Plan',
      billingFrequency: 'monthly',
      baseRateCents: BASE_RATE_CENTS,
      startDate: DECEMBER_START,
      endDate: null,
      billingTiming: 'arrears',
      clientId,
      enableProration: false
    });

    await db.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId: line.contractLineId,
        sourceRunPrefix: 'journey-test',
      });
    });

    // --- generate + finalize: the rendered artifact is a finalized invoice ---
    const generated = await generateInvoice(januaryCycleId);
    expect(generated, JSON.stringify(generated)).toBeTruthy();
    expect(generated?.invoice_id, JSON.stringify(generated)).toBeDefined();
    const invoiceId = generated!.invoice_id;

    const finalizeResult = await finalizeInvoice(invoiceId);
    expect(finalizeResult, JSON.stringify(finalizeResult)).toEqual({ success: true });

    const invoiceRow = await tenantTable(db, tenantId, 'invoices')
      .where({ tenant: tenantId, invoice_id: invoiceId })
      .first();
    expect(invoiceRow?.status).toBe('sent');
    const invoiceNumber = String(invoiceRow?.invoice_number);
    expect(invoiceNumber.length).toBeGreaterThan(0);

    const pdfService = createPDFGenerationService(tenantId);

    // Seam 1: the REAL renderer produces a structurally valid PDF — the
    // standard template AST shipped by the migrations, server-rendered HTML,
    // and an actual headless Chromium print via puppeteer. Nothing is mocked.
    const pdfBuffer = await pdfService.generatePDF({ invoiceId, userId: journeyUserId });
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdfBuffer.length).toBeGreaterThan(2048);
    // Structural sanity without a PDF parser (pdf-lib is aliased to
    // empty-module in server/vitest.config.ts): a complete PDF carries a
    // cross-reference pointer and the end-of-file marker.
    const pdfTail = pdfBuffer.subarray(-1024).toString('latin1');
    expect(pdfTail).toContain('startxref');
    expect(pdfTail).toContain('%%EOF');

    // Seam 2: the invoice number lands in the rendered output. No PDF
    // text-extraction dependency is usable in this runner (pdf-lib is stubbed
    // out, and Chromium embeds subset fonts so the bytes are not grep-able),
    // so this pins the HTML from the same template-AST evaluation that feeds
    // the PDF print above.
    const preview = await pdfService.renderInvoicePreview({ invoiceId });
    expect(preview.html).toContain(invoiceNumber);

    // Seam 3: generateAndStore writes the bytes through the real
    // LocalStorageProvider and records them as a tenant-scoped external_files
    // row. Note what does NOT happen: no documents row, no
    // document_associations row — for invoice PDFs the file store IS the
    // document record.
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
    });
    expect(fileRecord?.file_id, JSON.stringify(fileRecord)).toBeDefined();

    const storedRow = await tenantTable(db, tenantId, 'external_files')
      .where({ tenant: tenantId, file_id: fileRecord.file_id })
      .first();
    expect(storedRow, 'external_files row for the generated PDF').toBeTruthy();
    expect(storedRow?.tenant).toBe(tenantId);
    expect(storedRow?.mime_type).toBe('application/pdf');
    // The invoice-number linkage the storage layer provides: the stored file
    // is named after the invoice number.
    expect(storedRow?.original_name).toBe(`${invoiceNumber}.pdf`);
    expect(storedRow?.uploaded_by_id).toBe(journeyUserId);
    expect(Number(storedRow?.file_size)).toBeGreaterThan(2048);
    expect(String(storedRow?.storage_path)).toContain(`pdfs/${tenantId}/`);

    // The bytes on disk are the stored PDF, byte-for-byte the recorded size.
    const storedBytes = await fs.readFile(path.join(storageBaseDir, String(storedRow!.storage_path)));
    expect(storedBytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(storedBytes.length).toBe(Number(storedRow?.file_size));

    // Seam 4: the invoice↔file linkage travels on the DOCUMENT_GENERATED
    // workflow event (there is no linking table for this path).
    const generatedEvents = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(generatedEvents).toHaveLength(1);
    expect(generatedEvents[0].payload).toMatchObject({
      documentId: fileRecord.file_id,
      sourceType: 'invoice',
      sourceId: invoiceId,
      fileName: `${invoiceNumber}.pdf`,
    });

    // Tenant scoping: the tenantDb facade cannot see the row from another
    // tenant's scope.
    const foreignScopeRows = await tenantTable(db, uuidv4(), 'external_files')
      .where({ file_id: fileRecord.file_id });
    expect(foreignScopeRows).toHaveLength(0);

    // Seam 5: re-render. The code has no reuse or versioning — every
    // generateAndStore call renders again and creates a brand-new
    // external_files row and a brand-new file on disk (the `version` option is
    // accepted but never read). Asserted as the current behavior.
    const secondRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
    });
    expect(secondRecord.file_id).not.toBe(fileRecord.file_id);

    const allStoredRows = await tenantTable(db, tenantId, 'external_files')
      .where({ tenant: tenantId, original_name: `${invoiceNumber}.pdf` })
      .orderBy('created_at', 'asc');
    expect(allStoredRows).toHaveLength(2);
    expect(allStoredRows[0].storage_path).not.toBe(allStoredRows[1].storage_path);

    const secondBytes = await fs.readFile(path.join(storageBaseDir, String(allStoredRows[1].storage_path)));
    expect(secondBytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    // Each render publishes its own linkage event.
    const eventsAfterRerender = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(eventsAfterRerender).toHaveLength(2);
    expect(eventsAfterRerender[1].payload).toMatchObject({
      documentId: secondRecord.file_id,
      sourceType: 'invoice',
      sourceId: invoiceId,
    });
  }, HOOK_TIMEOUT);
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
