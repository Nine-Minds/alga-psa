import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '44444444-4444-4444-8444-444444444444';
const INVOICE_ID = '33333333-3333-4333-8333-333333333333';
const SALES_ORDER_ID = '55555555-5555-4555-8555-555555555555';

type ChainResult = any;

// Minimal knex-ish chain: enough for the tenantDb facade calls the filing path makes.
function makeChain(result: ChainResult) {
  const chain: any = {
    calls: { where: [] as any[], update: [] as any[] },
  };
  const passthrough = ['where', 'andWhere', 'whereNotNull', 'whereIn', 'orderBy', 'select'];
  for (const method of passthrough) {
    chain[method] = vi.fn((...args: any[]) => {
      if (method === 'where') chain.calls.where.push(args[0]);
      return chain;
    });
  }
  chain.first = vi.fn(async () => (Array.isArray(result) ? result[0] : result));
  chain.pluck = vi.fn(async () => (Array.isArray(result) ? result : []));
  chain.update = vi.fn(async (values: any) => {
    chain.calls.update.push(values);
    return Array.isArray(result) ? result.length : 1;
  });
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

const tableResults: Record<string, ChainResult> = {};
const tableChains: Record<string, any> = {};
const rawMock = vi.fn(async () => ({ rows: [] }));

const mockKnex: any = Object.assign(
  (table: string) => {
    const chain = makeChain(tableResults[table] ?? undefined);
    tableChains[table] = chain;
    return chain;
  },
  { raw: (...args: any[]) => rawMock(...args) }
);

const createTenantKnex = vi.fn();
const uploadMock = vi.fn();
const createFileStoreMock = vi.fn();
const findFileStoreMock = vi.fn();
const documentInsertMock = vi.fn();
const documentAssociationCreateMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const getBrowserMock = vi.fn();
const releaseBrowserMock = vi.fn();
const resolveSalesOrderTemplateAstMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  withTransaction: (conn: any, handler: (trx: any) => Promise<unknown>) => handler(conn),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
    tenantJoin: (builder: any) => builder,
  }),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: async () => ({ upload: (...args: any[]) => uploadMock(...args) }),
  },
  generateStoragePath: (...parts: string[]) => parts.join('/'),
  FileStoreModel: {
    create: (...args: any[]) => createFileStoreMock(...args),
    findById: (...args: any[]) => findFileStoreMock(...args),
  },
}));

vi.mock('@alga-psa/documents/models', () => ({
  Document: { insert: (...args: any[]) => documentInsertMock(...args) },
  DocumentAssociation: { create: (...args: any[]) => documentAssociationCreateMock(...args) },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getTenantDefaultLocale: async () => 'en',
  getUserInfoForEmail: async () => null,
  resolveEmailLocale: async () => 'pt-BR',
}));

vi.mock('../src/services/browserPoolService', () => ({
  browserPoolService: {
    getBrowser: (...args: any[]) => getBrowserMock(...args),
    releaseBrowser: (...args: any[]) => releaseBrowserMock(...args),
  },
}));

// The render pipeline itself is covered elsewhere; this file is about what
// happens to the bytes afterwards.
vi.mock('../src/models/invoice', () => ({
  default: {
    getFullInvoiceById: async () => ({ invoice_id: INVOICE_ID, client_id: CLIENT_ID }),
    getAllTemplates: async () => [
      {
        template_id: 'template-1',
        name: 'Standard Invoice',
        version: 7,
        is_default: true,
        isStandard: true,
        templateAst: { kind: 'ast' },
      },
    ],
  },
}));

vi.mock('../src/lib/adapters/invoiceAdapters', () => ({
  mapDbInvoiceToWasmViewModel: () => ({ invoice_number: 'INV-100', hasMultipleLocations: false }),
}));

vi.mock('../src/lib/adapters/invoiceAdapters.server', () => ({
  enrichInvoiceViewModelWithLocations: async () => undefined,
}));

vi.mock('../src/lib/adapters/salesOrderAdapters', () => ({
  mapDbSalesOrderToViewModel: async () => ({ so_number: 'SO-9', client_id: CLIENT_ID }),
}));

vi.mock('../src/lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: async () => null,
}));

vi.mock('../src/lib/invoice-template-ast/evaluator', () => ({
  evaluateTemplateAst: () => ({}),
}));

vi.mock('../src/lib/invoice-template-ast/server-render', () => ({
  renderTemplateAstHtmlDocument: async () => '<!doctype html><html><body>doc</body></html>',
}));

vi.mock('../src/lib/invoice-template-ast/printSettings', () => ({
  resolvePdfPrintOptionsFromAst: () => ({ format: 'A4' }),
}));

vi.mock('../src/lib/sales-order-template-ast/templateSelection', () => ({
  resolveSalesOrderTemplateAst: (...args: any[]) => resolveSalesOrderTemplateAstMock(...args),
}));

import {
  createPDFGenerationService,
  publishGeneratedDocumentsToClient,
} from '../src/services/pdfGenerationService';

describe('generated document filing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(tableResults)) delete tableResults[key];
    for (const key of Object.keys(tableChains)) delete tableChains[key];

    const pageMock = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-filing-test')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    getBrowserMock.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(pageMock) });
    releaseBrowserMock.mockResolvedValue(undefined);

    createTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: TENANT_ID });
    uploadMock.mockResolvedValue({ path: 'stored/pdfs/INV-100.pdf' });
    createFileStoreMock.mockResolvedValue({
      file_id: 'file-1',
      storage_path: 'stored/pdfs/INV-100.pdf',
      file_size: 16,
    });
    findFileStoreMock.mockResolvedValue(null);
    documentInsertMock.mockResolvedValue({ document_id: 'doc-1' });
    documentAssociationCreateMock.mockResolvedValue({ association_id: 'assoc-1' });
    publishWorkflowEventMock.mockResolvedValue(undefined);
    resolveSalesOrderTemplateAstMock.mockResolvedValue({
      ast: { kind: 'ast' },
      source: 'tenant-default',
      code: null,
      templateId: 'so-template-1',
      templateVersion: 3,
    });

    tableResults.invoices = { invoice_number: 'INV-100', client_id: CLIENT_ID };
    tableResults.sales_orders = { so_number: 'SO-9', client_id: CLIENT_ID };
    tableResults.clients = { billing_contact_id: null, billing_email: 'billing@client.test' };
  });

  it('files a generated invoice under /Clients/Invoices, MSP-only, with both associations', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({
      invoiceId: INVOICE_ID,
      invoiceNumber: 'INV-100',
      userId: USER_ID,
    });

    expect(documentInsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        document_name: 'Invoice_INV-100.pdf',
        folder_path: '/Clients/Invoices',
        // Explicit, not inherited: /Clients/Invoices is a client-visible default
        // folder, but an unsent invoice stays MSP-only.
        is_client_visible: false,
        file_id: 'file-1',
        mime_type: 'application/pdf',
        tenant: TENANT_ID,
      })
    );

    const associations = documentAssociationCreateMock.mock.calls.map(([, input]) => input);
    expect(associations).toHaveLength(2);
    expect(associations).toContainEqual(
      expect.objectContaining({ entity_id: INVOICE_ID, entity_type: 'invoice', tenant: TENANT_ID })
    );
    expect(associations).toContainEqual(
      expect.objectContaining({ entity_id: CLIENT_ID, entity_type: 'client', tenant: TENANT_ID })
    );
    expect(result.document_id).toBeDefined();
  });

  it('records the template and locale the invoice was rendered from', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await service.generateAndStore({ invoiceId: INVOICE_ID, invoiceNumber: 'INV-100', userId: USER_ID });

    expect(documentInsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source_template_id: 'template-1',
        source_template_version: 7,
        rendered_locale: 'pt-BR',
      })
    );
  });

  it('emits DOCUMENT_GENERATED with the documents row id so the search indexer resolves it', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({
      invoiceId: INVOICE_ID,
      invoiceNumber: 'INV-100',
      userId: USER_ID,
    });

    const [event] = publishWorkflowEventMock.mock.calls[0];
    expect(event.eventType).toBe('DOCUMENT_GENERATED');
    expect(event.payload).toMatchObject({
      documentId: result.document_id,
      sourceType: 'invoice',
      sourceId: INVOICE_ID,
      fileName: 'INV-100.pdf',
    });
    expect(event.payload.documentId).not.toBe('file-1');
  });

  it('reuses the stored invoice PDF instead of rendering a second artifact', async () => {
    tableResults['document_associations as da'] = { document_id: 'doc-1', file_id: 'file-1' };
    findFileStoreMock.mockResolvedValue({ file_id: 'file-1', storage_path: 'stored/pdfs/INV-100.pdf' });

    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({
      invoiceId: INVOICE_ID,
      invoiceNumber: 'INV-100',
      userId: USER_ID,
    });

    expect(result).toMatchObject({ file_id: 'file-1', document_id: 'doc-1' });
    expect(getBrowserMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(documentInsertMock).not.toHaveBeenCalled();
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
  });

  it('renders and files afresh when regeneration is explicitly requested', async () => {
    tableResults['document_associations as da'] = { document_id: 'doc-1', file_id: 'file-1' };
    findFileStoreMock.mockResolvedValue({ file_id: 'file-1', storage_path: 'stored/pdfs/INV-100.pdf' });
    createFileStoreMock.mockResolvedValue({
      file_id: 'file-2',
      storage_path: 'stored/pdfs/INV-100-2.pdf',
      file_size: 16,
    });

    const service = createPDFGenerationService(TENANT_ID);
    const result = await service.generateAndStore({
      invoiceId: INVOICE_ID,
      invoiceNumber: 'INV-100',
      userId: USER_ID,
      regenerate: true,
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(documentInsertMock).toHaveBeenCalledTimes(1);
    expect(result.file_id).toBe('file-2');
    expect(result.document_id).not.toBe('doc-1');
  });

  it('files a sales order confirmation under /Clients/Sales Orders', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await service.generateAndStore({ salesOrderId: SALES_ORDER_ID, userId: USER_ID });

    expect(documentInsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        document_name: 'SalesOrder_SO-9.pdf',
        folder_path: '/Clients/Sales Orders',
        is_client_visible: false,
        source_template_id: 'so-template-1',
        source_template_version: 3,
      })
    );

    const associations = documentAssociationCreateMock.mock.calls.map(([, input]) => input);
    expect(associations).toContainEqual(
      expect.objectContaining({ entity_id: SALES_ORDER_ID, entity_type: 'sales_order' })
    );
    expect(associations).toContainEqual(
      expect.objectContaining({ entity_id: CLIENT_ID, entity_type: 'client' })
    );
  });

  it('keeps packing slips separate from the confirmation document', async () => {
    const service = createPDFGenerationService(TENANT_ID);
    await service.generateAndStore({
      salesOrderId: SALES_ORDER_ID,
      salesOrderDocumentType: 'packing-slip',
      userId: USER_ID,
    });

    expect(documentInsertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ document_name: 'PackingSlip_SO-9.pdf' })
    );
  });

  it('publishes filed documents to the client only when asked (send time)', async () => {
    tableResults.document_associations = ['doc-1', 'doc-2'];
    tableResults.documents = ['doc-1', 'doc-2'];

    const updated = await publishGeneratedDocumentsToClient(TENANT_ID, 'invoice', INVOICE_ID);

    expect(updated).toBe(2);
    expect(tableChains.documents.calls.update[0]).toEqual({ is_client_visible: true });
  });

  it('does not touch documents when the entity has none filed', async () => {
    tableResults.document_associations = [];

    const updated = await publishGeneratedDocumentsToClient(TENANT_ID, 'invoice', INVOICE_ID);

    expect(updated).toBe(0);
    expect(tableChains.documents).toBeUndefined();
  });
});
