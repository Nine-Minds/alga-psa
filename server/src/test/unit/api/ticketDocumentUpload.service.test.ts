import { beforeEach, describe, expect, it, vi } from 'vitest';

const { validateFileUploadMock, uploadFileMock, withTransactionMock } = vi.hoisted(() => ({
  validateFileUploadMock: vi.fn(),
  uploadFileMock: vi.fn(),
  withTransactionMock: vi.fn(),
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    validateFileUpload: (...args: unknown[]) => validateFileUploadMock(...args),
    uploadFile: (...args: unknown[]) => uploadFileMock(...args),
  },
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (...args: unknown[]) => withTransactionMock(...args),
  };
});

import { TicketService } from '../../../lib/api/services/TicketService';

function createSelectBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    where: vi.fn(() => builder),
    first: vi.fn().mockResolvedValue(result),
  };

  return builder;
}

function createTypeBuilder(result: unknown) {
  return {
    where: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(result),
    })),
  };
}

describe('TicketService.uploadTicketDocument', () => {
  const ticketId = '123e4567-e89b-12d3-a456-426614174000';
  const context = {
    tenant: 'tenant-1',
    userId: 'user-1',
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    validateFileUploadMock.mockResolvedValue(undefined);
    uploadFileMock.mockResolvedValue({
      file_id: 'file-1',
      storage_path: '/docs/file-1',
    });
  });

  it('T012/T013/T014: uploads the file, creates a ticket association, and returns the created document', async () => {
    const service = new TicketService();
    const insertedDocuments: Record<string, unknown>[] = [];
    const insertedAssociations: Record<string, unknown>[] = [];

    const trx = ((table: string) => {
      if (table === 'documents') {
        return {
          insert: vi.fn(async (record: Record<string, unknown>) => {
            insertedDocuments.push(record);
          }),
        };
      }

      if (table === 'document_associations') {
        return {
          insert: vi.fn(async (record: Record<string, unknown>) => {
            insertedAssociations.push(record);
          }),
        };
      }

      throw new Error(`Unexpected transaction table ${table}`);
    }) as any;

    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trxArg: unknown) => unknown) => callback(trx));

    const knex = vi.fn((table: string) => {
      if (table === 'tickets') {
        return createSelectBuilder({ ticket_id: ticketId });
      }

      if (table === 'document_folders') {
        return createSelectBuilder({ folder_path: '/Tickets/Attachments' });
      }

      if (table === 'document_types') {
        return createTypeBuilder(null);
      }

      if (table === 'shared_document_types') {
        return createTypeBuilder({ type_id: 'shared-pdf' });
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getDocumentById').mockResolvedValue({
      document_id: 'doc-1',
      document_name: 'report.pdf',
      file_id: 'file-1',
      type_name: 'application/pdf',
    });

    const file = new File([Buffer.from('hello world')], 'report.pdf', { type: 'application/pdf' });
    const result = await service.uploadTicketDocument(ticketId, file, context);

    expect(validateFileUploadMock).toHaveBeenCalledWith('tenant-1', 'application/pdf', file.size);
    expect(uploadFileMock).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(Buffer),
      'report.pdf',
      expect.objectContaining({
        mime_type: 'application/pdf',
        uploaded_by_id: 'user-1',
      }),
    );
    expect(insertedDocuments).toHaveLength(1);
    expect(insertedAssociations).toEqual([
      expect.objectContaining({
        document_id: insertedDocuments[0]?.document_id,
        entity_id: ticketId,
        entity_type: 'ticket',
        tenant: 'tenant-1',
      }),
    ]);
    expect(result).toMatchObject({
      document_id: 'doc-1',
      document_name: 'report.pdf',
      file_id: 'file-1',
    });
  });

  it('T015: rejects uploads that omit the file payload', async () => {
    const service = new TicketService();
    const knex = vi.fn((table: string) => {
      if (table === 'tickets') {
        return createSelectBuilder({ ticket_id: ticketId });
      }

      throw new Error(`Unexpected table ${table}`);
    }) as any;

    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });

    await expect(
      service.uploadTicketDocument(ticketId, undefined as any, context),
    ).rejects.toThrow('File is required');

    expect(uploadFileMock).not.toHaveBeenCalled();
  });
});
