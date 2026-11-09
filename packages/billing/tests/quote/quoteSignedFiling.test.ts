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
let existingSigned: unknown = undefined;

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  tenantDb: () => ({
    table: (table: string) => {
      if (table === 'quotes') {
        const query: any = {};
        query.where = vi.fn(() => query);
        query.first = vi.fn(async () => ({ title: 'Proposal', quote_number: 'Q-0042' }));
        return query;
      }
      if (table === 'document_associations as da') {
        const query: any = {};
        for (const m of ['where', 'andWhere', 'whereNotNull', 'orderBy', 'select', 'first']) query[m] = vi.fn(() => query);
        query.then = (resolve: any) => resolve(existingSigned);
        return query;
      }
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
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
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

import { createPDFGenerationService, SIGNED_QUOTE_FILE_SUFFIX } from '../../src/services/pdfGenerationService';
import { getStandardQuoteTemplateAstByCode } from '../../src/lib/quote-template-ast/standardTemplates';
import { buildQuoteViewModelAcceptance } from '../../src/lib/quoteAcceptance';

const acceptance = {
  signerName: 'Casey Signer',
  signerEmail: 'casey@example.com',
  signerTitle: 'CTO',
  acceptedAt: '2026-07-18T23:30:00.000Z',
  method: 'email_link',
  ipAddress: '203.0.113.9',
  timeZone: 'America/Los_Angeles',
};

const baseViewModel = {
  quote_id: QUOTE_ID,
  quote_number: 'Q-0042',
  title: 'Proposal',
  currency_code: 'USD',
  subtotal: 0,
  discount_total: 0,
  tax: 0,
  total_amount: 0,
  client: { name: 'Client', address: null },
  tenant: { name: 'Tenant', address: null },
  line_items: [],
  phases: [],
};

const renderedHtml = async () => {
  const browser = await getBrowserMock.mock.results[0].value;
  const page = await browser.newPage.mock.results[0].value;
  return page.setContent.mock.calls[0][0] as string;
};

describe('signed quote filing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existingSigned = undefined;
    const pageMock = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-signed')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    getBrowserMock.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(pageMock) });
    releaseBrowserMock.mockResolvedValue(undefined);
    createTenantKnex.mockResolvedValue({ knex: { scope: 'knex', raw: vi.fn().mockResolvedValue(undefined) }, tenant: TENANT_ID });
    mapDbQuoteToViewModel.mockImplementation(async (_k: unknown, _t: string, _id: string, opts?: { acceptance?: typeof acceptance }) => ({
      ...baseViewModel,
      accepted_by_name: opts?.acceptance ? opts.acceptance.signerName : null,
      acceptance: opts?.acceptance ? buildQuoteViewModelAcceptance(opts.acceptance, opts.acceptance.signerName) : null,
    }));
    resolveQuoteTemplateAst.mockResolvedValue({
      templateAst: getStandardQuoteTemplateAstByCode('standard-quote-default'),
      source: 'standard-fallback',
      standardCode: 'standard-quote-default',
    });
    uploadMock.mockImplementation(async (_b: Buffer, path: string) => ({ path }));
    createFileStoreMock.mockResolvedValue({ file_id: 'file-1', storage_path: 'stored/x.pdf', file_size: 11 });
    documentInsertMock.mockResolvedValue({ document_id: 'doc-1' });
    documentAssociationCreateMock.mockResolvedValue({ association_id: 'assoc-1' });
    publishWorkflowEventMock.mockResolvedValue(undefined);
  });

  it('files the signed copy as its own client-visible, quote-linked "-signed" document', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({
      quoteId: QUOTE_ID,
      quoteNumber: 'Q-0042',
      userId: USER_ID,
      quoteVariant: 'signed',
      acceptance,
    });

    expect(SIGNED_QUOTE_FILE_SUFFIX).toBe('-signed');
    expect(documentInsertMock).toHaveBeenCalledTimes(1);
    const [, row] = documentInsertMock.mock.calls[0];
    expect(row).toMatchObject({
      document_name: 'Proposal-signed.pdf',
      is_client_visible: true,
      folder_path: '/Quotes/Generated',
      tenant: TENANT_ID,
    });
    expect(row.document_name).toMatch(/-signed\.pdf$/);
    expect(createFileStoreMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ original_name: 'Proposal-signed.pdf' })
    );
    expect(documentAssociationCreateMock).toHaveBeenCalledTimes(1);
    expect(documentAssociationCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entity_id: QUOTE_ID, entity_type: 'quote' })
    );
    expect(result.document_id).toBeDefined();
  });

  it('stamps the acceptance block on the signed render only', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await service.generateAndStore({ quoteId: QUOTE_ID, userId: USER_ID, quoteVariant: 'signed', acceptance });
    const html = await renderedHtml();
    expect(html).toContain('data-quote-acceptance-block');
    expect(html).toContain('Casey Signer');
    expect(html).toContain('203.0.113.9');
    expect(mapDbQuoteToViewModel).toHaveBeenCalledWith(expect.anything(), TENANT_ID, QUOTE_ID, { acceptance: expect.objectContaining({ signerName: 'Casey Signer' }) });
  });

  it('leaves the sent copy exactly as before: same name, no block, no acceptance passed', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await service.generateAndStore({ quoteId: QUOTE_ID, quoteNumber: 'Q-0042', userId: USER_ID });
    const html = await renderedHtml();
    expect(html).not.toContain('data-quote-acceptance-block');
    expect(documentInsertMock.mock.calls[0][1].document_name).toBe('Proposal.pdf');
    expect(mapDbQuoteToViewModel).toHaveBeenCalledWith(expect.anything(), TENANT_ID, QUOTE_ID, { acceptance: undefined });
  });

  it('reuses an already-issued signed document instead of filing a second one', async () => {
    existingSigned = { document_id: 'doc-signed', file_id: 'file-signed', is_client_visible: true, source_template_id: null };
    const { FileStoreModel } = await import('@alga-psa/storage');
    (FileStoreModel.findById as any).mockResolvedValueOnce({ file_id: 'file-signed', storage_path: 'stored/signed.pdf' });

    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({ quoteId: QUOTE_ID, userId: USER_ID, quoteVariant: 'signed', acceptance });

    expect(result).toMatchObject({ document_id: 'doc-signed', file_id: 'file-signed' });
    expect(documentInsertMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('refuses a signed copy without acceptance details', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await expect(
      service.generateAndStore({ quoteId: QUOTE_ID, userId: USER_ID, quoteVariant: 'signed' })
    ).rejects.toThrow(/acceptance/i);
  });
});
