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
import { seedBillingCycle } from '../../../../test-utils/billingProfileTestHelpers';

// P0 journey (docs: journey-first testing pivot): the rendering leg the money
// journeys stop short of — a finalized invoice goes through the REAL renderer
// (createPDFGenerationService → standard-template AST from the migrations →
// server-rendered HTML → headless Chromium via puppeteer → PDF bytes) and the
// REAL storage path (LocalStorageProvider → external_files row → documents row
// + document_associations → the DOCUMENT_GENERATED workflow event). Nothing in
// the render/store/file pipeline is mocked; the only mocked seam is the
// event-bus publisher, replaced with a capture so the linkage payload can be
// asserted instead of disappearing into Redis.
//
// The filing contract this pins: a generated invoice PDF becomes a real
// document — filed under /Clients/Invoices, MSP-only until the invoice is sent,
// associated with both the invoice and its client, carrying the template and
// locale it was rendered from. Until it is published to the client that one
// document is refreshed in place; once published it is frozen and handed back,
// so the copy the client received never changes underneath them.

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
    await seedBillingCycle(db, tenantId, {
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
    // LocalStorageProvider, records them as a tenant-scoped external_files row,
    // and files the result as a document.
    const fileRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
    });
    expect(fileRecord?.file_id, JSON.stringify(fileRecord)).toBeDefined();
    expect(fileRecord?.document_id, JSON.stringify(fileRecord)).toBeDefined();

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

    // Seam 4: the PDF is filed as a document — a real row in the Documents UI,
    // under /Clients/Invoices, MSP-only until the invoice is sent, and carrying
    // the template it was rendered from.
    const documentRow = await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_id: fileRecord.document_id })
      .first();
    expect(documentRow, 'documents row for the generated PDF').toBeTruthy();
    expect(documentRow?.document_name).toBe(`Invoice_${invoiceNumber}.pdf`);
    expect(documentRow?.folder_path).toBe('/Clients/Invoices');
    expect(documentRow?.file_id).toBe(fileRecord.file_id);
    expect(documentRow?.mime_type).toBe('application/pdf');
    // Explicit, not inherited: /Clients/Invoices is itself a client-visible
    // default folder, but a generated-but-unsent invoice stays MSP-only.
    expect(documentRow?.is_client_visible).toBe(false);
    expect(documentRow?.source_template_id, 'template provenance').toBeTruthy();
    expect(documentRow).toHaveProperty('rendered_locale');

    // Seam 5: both associations — the invoice it renders and the client it
    // belongs to, so it surfaces in the client's Documents tab.
    const associations = await tenantTable(db, tenantId, 'document_associations')
      .where({ tenant: tenantId, document_id: fileRecord.document_id })
      .orderBy('entity_type', 'asc');
    expect(associations.map((a) => a.entity_type).sort()).toEqual(['client', 'invoice']);
    expect(associations.find((a) => a.entity_type === 'invoice')?.entity_id).toBe(invoiceId);
    expect(associations.find((a) => a.entity_type === 'client')?.entity_id).toBe(clientId);

    // Seam 6: the linkage event carries the documents row id (not the file id),
    // which is what the search indexer looks up.
    const generatedEvents = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(generatedEvents).toHaveLength(1);
    expect(generatedEvents[0].payload).toMatchObject({
      documentId: fileRecord.document_id,
      sourceType: 'invoice',
      sourceId: invoiceId,
      fileName: `${invoiceNumber}.pdf`,
    });
    expect(generatedEvents[0].payload.documentId).not.toBe(fileRecord.file_id);

    // Tenant scoping: the tenantDb facade cannot see the row from another
    // tenant's scope.
    const foreignScopeRows = await tenantTable(db, uuidv4(), 'external_files')
      .where({ file_id: fileRecord.file_id });
    expect(foreignScopeRows).toHaveLength(0);

    // Seam 7: while the invoice is still MSP-only, generating again refreshes the
    // one filed document in place. Downloads therefore neither pile up documents
    // nor leave the filed copy behind the invoice it renders.
    const secondRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
    });
    expect(secondRecord.document_id).toBe(fileRecord.document_id);
    expect(secondRecord.file_id).not.toBe(fileRecord.file_id);

    const refreshedDocument = await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_id: fileRecord.document_id })
      .first();
    expect(refreshedDocument?.file_id).toBe(secondRecord.file_id);

    const allDocumentRows = await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_name: `Invoice_${invoiceNumber}.pdf` });
    expect(allDocumentRows).toHaveLength(1);

    // The superseded render is retired rather than left to accumulate.
    const liveStoredRows = await tenantTable(db, tenantId, 'external_files')
      .where({ tenant: tenantId, original_name: `${invoiceNumber}.pdf`, is_deleted: false });
    expect(liveStoredRows).toHaveLength(1);
    expect(liveStoredRows[0].file_id).toBe(secondRecord.file_id);

    const supersededRow = await tenantTable(db, tenantId, 'external_files')
      .where({ tenant: tenantId, file_id: fileRecord.file_id })
      .first();
    expect(supersededRow?.is_deleted).toBe(true);

    // A refresh changes the bytes, so the search indexer hears about it again.
    const eventsAfterRefresh = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(eventsAfterRefresh).toHaveLength(2);
    expect(eventsAfterRefresh[1].payload.documentId).toBe(fileRecord.document_id);

    // Seam 8: once the document has been published to the client — what happens
    // when the invoice is sent — it is the artifact they received. Generating
    // again hands the same bytes back rather than re-rendering underneath them.
    await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_id: fileRecord.document_id })
      .update({ is_client_visible: true });

    const issuedRecord = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
    });
    expect(issuedRecord.document_id).toBe(fileRecord.document_id);
    expect(issuedRecord.file_id).toBe(secondRecord.file_id);

    const eventsAfterIssuedReuse = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(eventsAfterIssuedReuse).toHaveLength(2);

    // Seam 9: a deliberate re-render of an issued invoice is visibly a new
    // document, not a silent mutation of the one already sent.
    const regenerated = await pdfService.generateAndStore({
      invoiceId,
      invoiceNumber,
      version: 1,
      userId: journeyUserId,
      regenerate: true,
    });
    expect(regenerated.file_id).not.toBe(secondRecord.file_id);
    expect(regenerated.document_id).not.toBe(fileRecord.document_id);

    const issuedDocument = await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_id: fileRecord.document_id })
      .first();
    expect(issuedDocument?.file_id, 'the issued copy is left alone').toBe(secondRecord.file_id);

    const documentsAfterRegenerate = await tenantTable(db, tenantId, 'documents')
      .where({ tenant: tenantId, document_name: `Invoice_${invoiceNumber}.pdf` });
    expect(documentsAfterRegenerate).toHaveLength(2);

    const regeneratedStoredRow = await tenantTable(db, tenantId, 'external_files')
      .where({ tenant: tenantId, file_id: regenerated.file_id })
      .first();
    const regeneratedBytes = await fs.readFile(
      path.join(storageBaseDir, String(regeneratedStoredRow!.storage_path)),
    );
    expect(regeneratedBytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');

    const eventsAfterRegenerate = publishWorkflowEventMock.mock.calls
      .map(([event]) => event as PublishedWorkflowEvent)
      .filter((e) => e.eventType === 'DOCUMENT_GENERATED');
    expect(eventsAfterRegenerate).toHaveLength(3);
    expect(eventsAfterRegenerate[2].payload).toMatchObject({
      documentId: regenerated.document_id,
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
