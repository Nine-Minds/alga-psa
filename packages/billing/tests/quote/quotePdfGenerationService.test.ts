import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const QUOTE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const createTenantKnex = vi.fn();
const mapDbQuoteToViewModel = vi.fn();
const resolveQuoteTemplateAst = vi.fn();
const quoteGetById = vi.fn();
const uploadMock = vi.fn();
const createFileStoreMock = vi.fn();
const getBrowserMock = vi.fn();
const releaseBrowserMock = vi.fn();
const documentInsertMock = vi.fn();
const documentAssociationCreateMock = vi.fn();
const publishWorkflowEventMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  tenantDb: () => ({
    table: (table: string) => {
      throw new Error(`Unexpected tenantDb table access: ${table}`);
    },
    tenantJoin: (builder: any) => builder,
  }),
}));

vi.mock('@alga-psa/documents/models', () => ({
  Document: { insert: (...args: any[]) => documentInsertMock(...args) },
  DocumentAssociation: { create: (...args: any[]) => documentAssociationCreateMock(...args) },
}));

vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getTenantDefaultLocale: async () => 'en',
  getUserInfoForEmail: async () => null,
  resolveEmailLocale: async () => 'en',
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

vi.mock('../../src/lib/adapters/quoteAdapters', () => ({
  mapDbQuoteToViewModel: (...args: any[]) => mapDbQuoteToViewModel(...args),
}));

vi.mock('../../src/lib/quote-template-ast/templateSelection', () => ({
  resolveQuoteTemplateAst: (...args: any[]) => resolveQuoteTemplateAst(...args),
}));

vi.mock('../../src/models/quote', () => ({
  default: {
    getById: (...args: any[]) => quoteGetById(...args),
  },
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: async () => ({
      upload: (...args: any[]) => uploadMock(...args),
    }),
  },
  generateStoragePath: (...parts: string[]) => parts.join('/'),
  FileStoreModel: {
    create: (...args: any[]) => createFileStoreMock(...args),
    findById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/browserPoolService', () => ({
  browserPoolService: {
    getBrowser: (...args: any[]) => getBrowserMock(...args),
    releaseBrowser: (...args: any[]) => releaseBrowserMock(...args),
  },
}));

import { createPDFGenerationService } from '../../src/services/pdfGenerationService';
import { getStandardQuoteTemplateAstByCode } from '../../src/lib/quote-template-ast/standardTemplates';

describe('quotePdfGenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const pageMock = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-quote-test')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browserMock = {
      newPage: vi.fn().mockResolvedValue(pageMock),
    };

    getBrowserMock.mockResolvedValue(browserMock);
    releaseBrowserMock.mockResolvedValue(undefined);
    createTenantKnex.mockResolvedValue({ knex: { scope: 'knex' }, tenant: TENANT_ID });
    mapDbQuoteToViewModel.mockResolvedValue({
      quote_id: QUOTE_ID,
      quote_number: 'Q-0042',
      title: 'Proposal',
      description: 'Managed services',
      scope_of_work: 'Managed services',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: '2026-03-20T00:00:00.000Z',
      status: 'draft',
      version: 1,
      po_number: null,
      currency_code: 'USD',
      subtotal: 1000,
      discount_total: 0,
      tax: 0,
      total_amount: 1000,
      terms_and_conditions: 'Net 30',
      client_notes: null,
      client_id: 'client-1',
      contact_id: null,
      client: { name: 'Client', address: null, email: null, phone: null, logo_url: null },
      contact: null,
      tenant: { name: 'Tenant', address: null, email: null, phone: null, logo_url: null },
      line_items: [
        {
          quote_item_id: 'item-1',
          service_id: null,
          service_name: null,
          service_sku: null,
          billing_method: 'fixed',
          description: 'Managed services',
          quantity: 1,
          unit_price: 1000,
          total_price: 1000,
          tax_amount: 0,
          net_amount: 1000,
          unit_of_measure: null,
          phase: null,
          is_optional: false,
          is_selected: true,
          is_recurring: false,
          billing_frequency: null,
          is_discount: false,
          discount_type: null,
          discount_percentage: null,
          applies_to_item_id: null,
          applies_to_service_id: null,
          tax_region: null,
          tax_rate: null,
        },
      ],
      phases: [],
    });
    resolveQuoteTemplateAst.mockResolvedValue({
      templateAst: getStandardQuoteTemplateAstByCode('standard-quote-default'),
      source: 'standard-fallback',
      standardCode: 'standard-quote-default',
    });
    quoteGetById.mockResolvedValue({ quote_id: QUOTE_ID, quote_number: 'Q-0042' });
    uploadMock.mockResolvedValue({ path: 'stored/pdfs/Q-0042.pdf' });
    createFileStoreMock.mockResolvedValue({ file_id: 'file-1', storage_path: 'stored/pdfs/Q-0042.pdf', file_size: 15 });
    documentInsertMock.mockResolvedValue({ document_id: 'doc-1' });
    documentAssociationCreateMock.mockResolvedValue({ association_id: 'assoc-1' });
    publishWorkflowEventMock.mockResolvedValue(undefined);
  });

  it('T083: generates a valid PDF buffer from quote data', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const pdf = await service.generatePDF({ quoteId: QUOTE_ID, userId: USER_ID });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.toString('utf8')).toContain('%PDF-quote-test');
    const browser = await getBrowserMock.mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('<!doctype html>'), { waitUntil: 'load' });
  });

  it('T084: stores generated file in file storage and returns file_id', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({ quoteId: QUOTE_ID, quoteNumber: 'Q-0042', userId: USER_ID });

    expect(uploadMock).toHaveBeenCalledWith(expect.any(Buffer), '22222222-2222-4222-8222-222222222222/pdfs/Q-0042.pdf', {
      mime_type: 'application/pdf',
    });
    expect(createFileStoreMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        original_name: 'Q-0042.pdf',
        uploaded_by_id: USER_ID,
      })
    );
    expect(result).toMatchObject({ file_id: 'file-1' });
  });

  it('T084b: files the stored quote PDF as a client-visible document under /Quotes/Generated', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({ quoteId: QUOTE_ID, quoteNumber: 'Q-0042', userId: USER_ID });

    expect(documentInsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        document_name: 'Quote_Q-0042.pdf',
        mime_type: 'application/pdf',
        file_id: 'file-1',
        folder_path: '/Quotes/Generated',
        is_client_visible: true,
        tenant: TENANT_ID,
        source_template_id: 'standard-quote-default',
        rendered_locale: 'en',
      })
    );
    // Quote filing carries the quote association only — unchanged from before.
    expect(documentAssociationCreateMock).toHaveBeenCalledTimes(1);
    expect(documentAssociationCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity_id: QUOTE_ID, entity_type: 'quote', tenant: TENANT_ID })
    );
    expect(result.document_id).toBeDefined();
  });

  it('T084c: DOCUMENT_GENERATED carries the documents row id, not the file id', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({ quoteId: QUOTE_ID, quoteNumber: 'Q-0042', userId: USER_ID });

    const [event] = publishWorkflowEventMock.mock.calls[0];
    expect(event.eventType).toBe('DOCUMENT_GENERATED');
    expect(event.payload).toMatchObject({
      documentId: result.document_id,
      sourceType: 'quote',
      sourceId: QUOTE_ID,
      fileName: 'Q-0042.pdf',
    });
    expect(event.payload.documentId).not.toBe('file-1');
  });
});
