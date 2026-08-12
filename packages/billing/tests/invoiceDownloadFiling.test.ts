import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateAndStoreMock = vi.fn();
const generatePDFMock = vi.fn();
const downloadFileMock = vi.fn();

function createQueryBuilder() {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.first = vi.fn(async () => ({
    invoice_id: 'invoice-1',
    invoice_number: 'INV-42',
    client_id: 'client-1',
  }));
  return builder;
}

const mockTrx = ((_table: string) => createQueryBuilder()) as any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  getSession: vi.fn(async () => ({ user: { id: 'user-1' } })),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: mockTrx, tenant: 'tenant-1' })),
    withTransaction: vi.fn(async (_knex: any, callback: any) => callback(mockTrx)),
    tenantDb: () => ({ table: () => createQueryBuilder() }),
  };
});

vi.mock('../src/services/pdfGenerationService', () => ({
  createPDFGenerationService: () => ({
    generateAndStore: (...args: any[]) => generateAndStoreMock(...args),
    generatePDF: (...args: any[]) => generatePDFMock(...args),
  }),
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: (...args: any[]) => downloadFileMock(...args),
  },
}));

import { downloadInvoicePDF } from '../src/actions/invoiceGeneration';

describe('downloading an invoice PDF as an MSP biller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAndStoreMock.mockResolvedValue({ file_id: 'file-1', document_id: 'doc-1' });
    downloadFileMock.mockResolvedValue({ buffer: Buffer.from('%PDF-stored') });
    generatePDFMock.mockResolvedValue(Buffer.from('%PDF-rendered'));
  });

  it('files the invoice and hands back the stored bytes', async () => {
    const result: any = await downloadInvoicePDF('invoice-1');

    // The download is what a biller actually clicks, so it is the path that has to
    // put the invoice in Documents.
    expect(generateAndStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'invoice-1',
        invoiceNumber: 'INV-42',
        regenerate: false,
        userId: 'user-1',
      })
    );
    expect(downloadFileMock).toHaveBeenCalledWith('file-1');
    expect(generatePDFMock).not.toHaveBeenCalled();
    expect(Buffer.from(result.pdfData).toString()).toBe('%PDF-stored');
    expect(result.invoiceNumber).toBe('INV-42');
  });

  it('renders again when the biller picks a different template', async () => {
    await downloadInvoicePDF('invoice-1', 'template-9');

    expect(generateAndStoreMock).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'template-9', regenerate: true })
    );
  });

  it('still downloads when filing the document is not possible', async () => {
    generateAndStoreMock.mockRejectedValue(new Error('storage provider unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result: any = await downloadInvoicePDF('invoice-1');

    expect(Buffer.from(result.pdfData).toString()).toBe('%PDF-rendered');
    consoleError.mockRestore();
  });
});
