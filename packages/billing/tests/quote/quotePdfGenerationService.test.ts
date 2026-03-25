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

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
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

vi.mock('../../src/lib/documentsHelpers', () => ({
  getStorageProviderFactoryAsync: async () => ({
    StorageProviderFactory: {
      createProvider: async () => ({
        upload: (...args: any[]) => uploadMock(...args),
      }),
    },
    generateStoragePath: (...parts: string[]) => parts.join('/'),
  }),
  getFileStoreModelAsync: async () => ({
    create: (...args: any[]) => createFileStoreMock(...args),
  }),
}));

vi.mock('../../src/services/browserPoolService', () => ({
  browserPoolService: {
    getBrowser: (...args: any[]) => getBrowserMock(...args),
    releaseBrowser: (...args: any[]) => releaseBrowserMock(...args),
  },
}));

import { createQuotePDFGenerationService } from '../../src/services/quotePdfGenerationService';
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
    createFileStoreMock.mockResolvedValue({ file_id: 'file-1', storage_path: 'stored/pdfs/Q-0042.pdf' });
  });

  it('T083: generates a valid PDF buffer from quote data', async () => {
    const service = createQuotePDFGenerationService(TENANT_ID);
    const pdf = await service.generatePDF({ quoteId: QUOTE_ID });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.toString('utf8')).toContain('%PDF-quote-test');
    const browser = await getBrowserMock.mock.results[0].value;
    const page = await browser.newPage.mock.results[0].value;
    expect(page.setContent).toHaveBeenCalledWith(expect.stringContaining('<!doctype html>'), { waitUntil: 'networkidle0' });
  });

  it('T084: stores generated file in file storage and returns file_id', async () => {
    const service = createQuotePDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({ quoteId: QUOTE_ID, userId: USER_ID });

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
});
