import { beforeEach, describe, expect, it, vi } from 'vitest';

const { validateFileUploadMock, uploadFileMock, withTransactionMock, generateDocumentPreviewsMock } = vi.hoisted(() => ({
  validateFileUploadMock: vi.fn(),
  uploadFileMock: vi.fn(),
  withTransactionMock: vi.fn(),
  generateDocumentPreviewsMock: vi.fn(),
}));

vi.mock('@alga-psa/documents/lib/documentPreviewGenerator', () => ({
  generateDocumentPreviews: (...args: unknown[]) => generateDocumentPreviewsMock(...args),
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
    tenantDb: (conn: any, _tenant: string) => ({
      table: (t: string) => conn(t),
      scoped: (t: string) => conn(t),
      subquery: (t: string) => conn(t),
      parentScopedTable: (t: string) => conn(t),
      unscoped: (t: string) => conn(t),
      tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
        o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
      tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
        o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
      tenantWhereColumn: (q: any) => q,
    }),
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
    generateDocumentPreviewsMock.mockResolvedValue({
      thumbnail_file_id: 'thumb-1',
      preview_file_id: 'preview-1',
      preview_generated_at: new Date('2026-09-10T00:00:00.000Z'),
    });
  });

  it('T012/T013/T014: uploads the file, creates a ticket association, and returns the created document', async () => {
    const service = new TicketService();
    const insertedDocuments: Record<string, unknown>[] = [];
    const insertedAssociations: Record<string, unknown>[] = [];
    const insertedAuditLogs: Record<string, unknown>[] = [];
    const previewUpdates: Record<string, unknown>[] = [];

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

      if (table === 'ticket_audit_logs') {
        return {
          insert: vi.fn(async (record: Record<string, unknown>) => {
            insertedAuditLogs.push(record);
          }),
        };
      }

      if (table === 'users') {
        // Best-effort actor display-name lookup inside writeTicketActivity.
        return {
          where: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(null),
          })),
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

      if (table === 'documents') {
        return {
          where: vi.fn(() => ({
            update: vi.fn(async (patch: Record<string, unknown>) => {
              previewUpdates.push(patch);
            }),
          })),
        };
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
    expect(insertedAuditLogs).toEqual([
      expect.objectContaining({
        tenant: 'tenant-1',
        ticket_id: ticketId,
        entity_id: insertedDocuments[0]?.document_id,
        actor_user_id: 'user-1',
      }),
    ]);
    expect(result).toMatchObject({
      document_id: 'doc-1',
      document_name: 'report.pdf',
      file_id: 'file-1',
    });
    // Previews are generated after commit and persisted on the document row.
    expect(generateDocumentPreviewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: insertedDocuments[0]?.document_id, mime_type: 'application/pdf' }),
      expect.any(Buffer),
    );
    expect(previewUpdates).toEqual([
      expect.objectContaining({ thumbnail_file_id: 'thumb-1', preview_file_id: 'preview-1' }),
    ]);
  });

  it('T016: a preview generation failure does not fail the upload', async () => {
    const service = new TicketService();
    generateDocumentPreviewsMock.mockRejectedValue(new Error('sharp missing'));
    withTransactionMock.mockImplementation(async (_knex: unknown, callback: (trxArg: unknown) => unknown) =>
      callback((table: string) => ({
        insert: vi.fn(async () => undefined),
        where: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
        ...(table === 'users' ? {} : {}),
      })),
    );
    const knex = vi.fn((table: string) => {
      if (table === 'tickets') return createSelectBuilder({ ticket_id: ticketId });
      if (table === 'document_folders') return createSelectBuilder(null);
      if (table === 'document_types') return createTypeBuilder(null);
      if (table === 'shared_document_types') return createTypeBuilder({ type_id: 'shared-img' });
      throw new Error(`Unexpected table ${table}`);
    }) as any;
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    vi.spyOn(service as any, 'getDocumentById').mockResolvedValue({ document_id: 'doc-2', file_id: 'file-1' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const file = new File([Buffer.from('img')], 'photo.jpg', { type: 'image/jpeg' });
    await expect(service.uploadTicketDocument(ticketId, file, context)).resolves.toMatchObject({ document_id: 'doc-2' });
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
