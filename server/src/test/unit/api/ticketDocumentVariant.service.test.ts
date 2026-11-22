import { beforeEach, describe, expect, it, vi } from 'vitest';

const { downloadFileMock, generatePreviewsForDocumentMock, canReadCommentAttachmentMock, externalFiles } = vi.hoisted(() => ({
  downloadFileMock: vi.fn(),
  generatePreviewsForDocumentMock: vi.fn(),
  canReadCommentAttachmentMock: vi.fn(),
  externalFiles: [] as Array<{ tenant: string; file_id: string; is_deleted: boolean; metadata: Record<string, unknown> }>,
}));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: (...args: unknown[]) => downloadFileMock(...args),
  },
}));

vi.mock('@alga-psa/documents/lib/documentPreviewGenerator', () => ({
  generatePreviewsForDocument: (...args: unknown[]) => generatePreviewsForDocumentMock(...args),
}));

vi.mock('@shared/lib/ticketCommentAttachments', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@shared/lib/ticketCommentAttachments');
  return {
    ...actual,
    canReadCommentAttachment: (...args: unknown[]) => canReadCommentAttachmentMock(...args),
  };
});

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    tenantDb: (conn: any, tenant: string) => ({
      table: (t: string) => {
        if (t !== 'external_files') return conn(t);
        const filters: Record<string, unknown> = { tenant };
        let fileIds: string[] = [];
        const builder: any = {
          where: vi.fn((criteria: Record<string, unknown>) => { Object.assign(filters, criteria); return builder; }),
          whereIn: vi.fn((_column: string, ids: string[]) => { fileIds = ids; return builder; }),
          select: vi.fn(async () => externalFiles.filter((row) =>
            Object.entries(filters).every(([key, value]) => (row as any)[key] === value)
            && fileIds.includes(row.file_id))),
        };
        return builder;
      },
      tenantJoin: (q: any, t: string) => q.join?.(t) ?? q,
    }),
  };
});

import { TicketService } from '../../../lib/api/services/TicketService';

const ticketId = '123e4567-e89b-12d3-a456-426614174000';
const context = { tenant: 'tenant-1', userId: 'user-1' } as any;

function setup(doc: Record<string, unknown> | undefined) {
  const service = new TicketService();
  const updates: Record<string, unknown>[] = [];
  const docBuilder = {
    join: vi.fn(() => docBuilder),
    where: vi.fn(() => docBuilder),
    select: vi.fn(() => docBuilder),
    first: vi.fn().mockResolvedValue(doc),
  };
  const knex = vi.fn((table: string) => {
    if (table === 'documents as d') return docBuilder;
    if (table === 'documents') {
      return { where: vi.fn(() => ({ update: vi.fn(async (patch: Record<string, unknown>) => { updates.push(patch); }) })) };
    }
    throw new Error(`Unexpected table ${table}`);
  }) as any;
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
  vi.spyOn(service as any, 'resolveClientTicketVisibility').mockResolvedValue(null);
  return { service, updates };
}

describe('TicketService.downloadTicketDocumentVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalFiles.length = 0;
    canReadCommentAttachmentMock.mockResolvedValue(true);
    downloadFileMock.mockImplementation(async (fileId: string) => ({
      buffer: Buffer.from(`bytes:${fileId}`),
      metadata: { original_name: `${fileId}.jpg`, mime_type: 'image/jpeg', size: 3 },
    }));
  });

  it('serves the stored thumbnail without regenerating', async () => {
    const { service, updates } = setup({
      document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/jpeg',
      thumbnail_file_id: 'thumb-1', preview_file_id: 'preview-1', preview_generated_at: new Date(),
    });

    const result = await service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'thumbnail', context);

    expect(result).toMatchObject({ fileId: 'thumb-1', mimeType: 'image/jpeg' });
    expect(result.buffer.toString()).toBe('bytes:thumb-1');
    expect(downloadFileMock).toHaveBeenCalledTimes(1);
    expect(generatePreviewsForDocumentMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('generates previews from storage on first request for an image uploaded without them', async () => {
    const { service, updates } = setup({
      document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/png', created_by: 'user-1',
      thumbnail_file_id: null, preview_file_id: null, preview_generated_at: null,
    });
    // The generator reads storage itself and persists the document columns.
    generatePreviewsForDocumentMock.mockResolvedValue({
      thumbnail_file_id: 'thumb-new', preview_file_id: 'preview-new', preview_generated_at: new Date(),
    });

    const result = await service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'preview', context);

    expect(generatePreviewsForDocumentMock).toHaveBeenCalledWith('doc-1');
    expect(downloadFileMock).not.toHaveBeenCalledWith('file-1'); // the original is never loaded here
    expect(updates).toEqual([]);
    expect(downloadFileMock).toHaveBeenCalledWith('preview-new');
    expect(result.fileId).toBe('preview-new');
  });

  it('returns not found when on-demand generation fails', async () => {
    const { service } = setup({
      document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/png', created_by: 'user-1',
      thumbnail_file_id: null, preview_file_id: null, preview_generated_at: null,
    });
    generatePreviewsForDocumentMock.mockRejectedValue(new Error('sharp missing'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'thumbnail', context))
      .rejects.toThrow('Document thumbnail not available');
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it('returns not found for document types that have no previews', async () => {
    const { service } = setup({
      document_id: 'doc-1', file_id: 'file-1', mime_type: 'text/plain',
      thumbnail_file_id: null, preview_file_id: null, preview_generated_at: null,
    });

    await expect(service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'thumbnail', context))
      .rejects.toThrow('Document thumbnail not available');
    expect(generatePreviewsForDocumentMock).not.toHaveBeenCalled();
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it('does not retry generation once a previous attempt has been recorded', async () => {
    const { service } = setup({
      document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/jpeg',
      thumbnail_file_id: null, preview_file_id: null, preview_generated_at: new Date(),
    });

    await expect(service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'thumbnail', context))
      .rejects.toThrow('Document thumbnail not available');
    expect(generatePreviewsForDocumentMock).not.toHaveBeenCalled();
  });

  it('hides documents the caller may not read', async () => {
    canReadCommentAttachmentMock.mockResolvedValue(false);
    const { service } = setup({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'image/jpeg', thumbnail_file_id: 'thumb-1' });

    await expect(service.downloadTicketDocumentVariant(ticketId, 'doc-1', 'thumbnail', context))
      .rejects.toThrow('Document not found');
  });
});
