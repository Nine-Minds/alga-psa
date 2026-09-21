import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateFileUploadMock = vi.fn();
const fileRow = {
  file_id: '11111111-1111-4111-8111-111111111111',
  file_name: 'stored-voicemail.wav',
  original_name: 'voicemail.wav',
  mime_type: 'audio/wav',
  file_size: 1234,
  storage_path: 'test/tenant-1/voicemail.wav',
};

const insertedDocuments: any[] = [];
const insertedAssociations: any[] = [];

function makeBuilder(table: string) {
  const builder: any = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn(async () => {
      if (table === 'tickets') return { ticket_id: '22222222-2222-4222-8222-222222222222' };
      if (table === 'external_files') return { ...fileRow };
      return undefined;
    }),
    insert: vi.fn(async (row: any) => {
      if (table === 'documents') insertedDocuments.push(row);
      if (table === 'document_associations') insertedAssociations.push(row);
      return [row];
    }),
    onConflict: vi.fn().mockReturnThis(),
    ignore: vi.fn().mockResolvedValue(undefined),
  };
  return builder;
}

const fakeKnex: any = {
  table: (name: string) => makeBuilder(name),
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => conn,
}));

vi.mock('@alga-psa/storage', () => ({
  StorageService: {
    validateFileUpload: (...args: any[]) => validateFileUploadMock(...args),
  },
}));

describe('attachDocumentToTicket — shared upload policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedDocuments.length = 0;
    insertedAssociations.length = 0;
  });

  it('accepts an audio attachment by delegating to StorageService.validateFileUpload', async () => {
    validateFileUploadMock.mockResolvedValue(undefined);
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    const result = await attachDocumentToTicket(
      { stepPath: 'step-1', runId: 'run-1' } as any,
      { tenantId: 'tenant-1', actorUserId: 'user-1', trx: fakeKnex } as any,
      '22222222-2222-4222-8222-222222222222',
      { source: { file_id: fileRow.file_id } }
    );

    expect(validateFileUploadMock).toHaveBeenCalledWith('tenant-1', 'audio/wav', 1234);
    expect(result).toMatchObject({
      file_id: fileRow.file_id,
      filename: fileRow.original_name,
      content_type: 'audio/wav',
    });
    expect(insertedDocuments).toHaveLength(1);
    expect(insertedAssociations).toHaveLength(1);
  });

  it('rejects a disallowed attachment when the shared policy rejects it', async () => {
    validateFileUploadMock.mockRejectedValue(new Error('File type not allowed'));
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(
        { stepPath: 'step-1', runId: 'run-1' } as any,
        { tenantId: 'tenant-1', actorUserId: 'user-1', trx: fakeKnex } as any,
        '22222222-2222-4222-8222-222222222222',
        { source: { file_id: fileRow.file_id } }
      )
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(insertedDocuments).toHaveLength(0);
  });
});
