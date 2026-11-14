import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const uploadFile = vi.fn();
const deleteFile = vi.fn();
const inserted = vi.hoisted(() => ({ rows: [] as Array<{ table: string; row: Record<string, unknown> }> }));
const txState = vi.hoisted(() => ({ failWith: null as Error | null }));
const adapterState = vi.hoisted(() => ({ resolveFolderError: null as Error | null }));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { uploadFile: (...a: unknown[]) => uploadFile(...a), deleteFile: (...a: unknown[]) => deleteFile(...a) },
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({ first: async () => ({ type_id: 'type-1' }) }),
      insert: async (row: Record<string, unknown>) => { inserted.rows.push({ table, row }); },
    }),
  }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => {
    if (txState.failWith) throw txState.failWith;
    return fn({});
  },
}));
vi.mock('@alga-psa/documents/lib/documentPreviewJob', () => ({ scheduleDocumentPreviews: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: () => ({}) }));
vi.mock('server/src/lib/api/services/documents/entityAdapters', () => ({
  ENTITY_ADAPTERS: {
    ticket: {
      resolveFolder: async () => { if (adapterState.resolveFolderError) throw adapterState.resolveFolderError; return '/'; },
      documentOverrides: undefined,
      inTransaction: undefined,
    },
  },
}));

import { UploadContentTypeError, UploadSizeLimitError } from '@alga-psa/storage/ingest/errors';
import { PayloadTooLargeError, ValidationError } from 'server/src/lib/api/middleware/apiErrors';
import { attachDocument } from 'server/src/lib/api/services/documents/attachDocument';

const base = {
  knex: {} as any,
  tenant: 'tenant-1',
  actorUserId: 'user-1',
  target: { entityType: 'ticket' as const, entityId: 'ticket-1' },
  source: 'multipart' as const,
  loadDocument: async (id: string) => ({ document_id: id } as any),
};

beforeEach(() => {
  vi.clearAllMocks();
  inserted.rows.length = 0;
  txState.failWith = null;
  adapterState.resolveFolderError = null;
});

describe('attachDocument (streaming core)', () => {
  it('hands the stream itself to the ingest and records the stored (sniffed) type and size', async () => {
    const body = Readable.from([Buffer.from('abc')]);
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'image/png', file_size: 3 });

    const doc = await attachDocument({ ...base, file: { fileName: 'x.bin', mimeType: 'application/octet-stream', body } });

    expect(uploadFile.mock.calls[0]![1]).toBe(body);
    expect(doc.document_id).toBeTruthy();
    // The row records what the ingest stored (sniffed png, 3 bytes), not what the caller declared.
    // (The external_files row is written by StorageService.uploadFile; streamIngest.test.ts in
    // packages/storage asserts its mime_type and file_size.)
    const documentRow = inserted.rows.find((r) => r.table === 'documents')!.row;
    expect(documentRow).toMatchObject({ mime_type: 'image/png', file_size: 3, file_id: 'f1', storage_path: 'p' });
  });

  it('maps an ingest size refusal to a 413 and a type refusal to a 400, and stops the source', async () => {
    const body = Readable.from([Buffer.from('abc')]);
    uploadFile.mockRejectedValue(new UploadSizeLimitError(100));
    const tooBig = await attachDocument({ ...base, file: { fileName: 'x', mimeType: 'a/b', body } }).catch((e) => e);
    expect(tooBig).toBeInstanceOf(PayloadTooLargeError);
    expect(body.destroyed).toBe(true);

    uploadFile.mockRejectedValue(new UploadContentTypeError('File type not allowed', 'a/b', undefined));
    const badType = await attachDocument({ ...base, file: { fileName: 'x', mimeType: 'a/b', body: Readable.from([]) } }).catch((e) => e);
    expect(badType).toBeInstanceOf(ValidationError);
  });

  it('surfaces an error raised inside the source stream through mapSourceError, not the storage wrapper', async () => {
    const body = new Readable({ read() {} });
    const sourceFailure = new Error('timed out downloading');
    const mapped = new ValidationError('mapped');
    uploadFile.mockImplementation(async () => {
      body.destroy(sourceFailure);
      await new Promise((r) => setImmediate(r));
      throw new Error('Failed to upload file: timed out downloading');
    });

    const error = await attachDocument({
      ...base,
      file: { fileName: 'x', mimeType: 'a/b', body, mapSourceError: (e) => (e === sourceFailure ? mapped : e) },
    }).catch((e) => e);

    expect(error).toBe(mapped);
  });

  it('rolls the stored file back (deleteFile with the stored file id) when the document transaction fails', async () => {
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 1 });
    txState.failWith = new Error('insert failed');

    await expect(attachDocument({ ...base, file: { fileName: 'x', mimeType: 'text/plain', body: Buffer.from('a') } })).rejects.toThrow('insert failed');

    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith('f1', 'user-1');
  });

  it('still surfaces the original error when the rollback cleanup itself fails', async () => {
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 1 });
    txState.failWith = new Error('insert failed');
    deleteFile.mockRejectedValueOnce(new Error('storage down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(attachDocument({ ...base, file: { fileName: 'x', mimeType: 'text/plain', body: Buffer.from('a') } })).rejects.toThrow('insert failed');
  });

  it('keeps the stored file when the committed document cannot be loaded afterwards (never deletes after commit)', async () => {
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 1 });
    const failing = { ...base, loadDocument: async () => null };
    await expect(attachDocument({ ...failing, file: { fileName: 'x', mimeType: 'text/plain', body: Buffer.from('a') } })).rejects.toThrow('could not be loaded');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('without a mapSourceError, a source-stream ingest refusal still surfaces as a 413, not a raw error', async () => {
    const body = new Readable({ read() {} });
    const refusal = new UploadSizeLimitError(5);
    uploadFile.mockImplementation(async () => {
      body.destroy(refusal);
      await new Promise((r) => setImmediate(r));
      throw new Error('Failed to upload file: File size exceeds limit of 5 bytes');
    });

    const error = await attachDocument({ ...base, file: { fileName: 'x', mimeType: 'a/b', body } }).catch((e) => e);

    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.statusCode).toBe(413);
  });

  describe('destroys the source stream on every error path (F29)', () => {
    it('when a step after the upload throws (folder resolution)', async () => {
      const body = Readable.from([Buffer.from('abc')]);
      uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 3 });
      adapterState.resolveFolderError = new Error('folder lookup failed');

      await expect(attachDocument({ ...base, file: { fileName: 'x', mimeType: 'text/plain', body } })).rejects.toThrow('folder lookup failed');

      expect(body.destroyed).toBe(true);
      expect(deleteFile).toHaveBeenCalledWith('f1', 'user-1');
    });

    it('when the target is refused before the upload starts (uploadFile is never reached)', async () => {
      const body = Readable.from([Buffer.from('abc')]);

      const error = await attachDocument({
        ...base,
        target: { entityType: 'nonsense' as any, entityId: 'x' },
        file: { fileName: 'x', mimeType: 'text/plain', body },
      }).catch((e) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect(uploadFile).not.toHaveBeenCalled();
      expect(body.destroyed).toBe(true);
    });

    it('when the upload itself throws a non-ingest error', async () => {
      const body = Readable.from([Buffer.from('abc')]);
      uploadFile.mockRejectedValue(new Error('provider down'));
      await expect(attachDocument({ ...base, file: { fileName: 'x', mimeType: 'a/b', body } })).rejects.toThrow('provider down');
      expect(body.destroyed).toBe(true);
    });
  });
});
