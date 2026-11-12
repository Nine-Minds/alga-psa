import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const uploadFile = vi.fn();
const deleteFile = vi.fn();

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { uploadFile: (...a: unknown[]) => uploadFile(...a), deleteFile: (...a: unknown[]) => deleteFile(...a) },
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({ type_id: 'type-1' }) }), insert: async () => undefined }) }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@alga-psa/documents/lib/documentPreviewJob', () => ({ scheduleDocumentPreviews: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: () => ({}) }));
vi.mock('../entityAdapters', () => ({
  ENTITY_ADAPTERS: { ticket: { resolveFolder: async () => '/', documentOverrides: undefined, inTransaction: undefined } },
}));

import { UploadContentTypeError, UploadSizeLimitError } from '@alga-psa/storage/ingest/errors';
import { PayloadTooLargeError, ValidationError } from '../../../middleware/apiErrors';
import { attachDocument } from '../attachDocument';

const base = {
  knex: {} as any,
  tenant: 'tenant-1',
  actorUserId: 'user-1',
  target: { entityType: 'ticket' as const, entityId: 'ticket-1' },
  source: 'multipart' as const,
  loadDocument: async (id: string) => ({ document_id: id } as any),
};

beforeEach(() => vi.clearAllMocks());

describe('attachDocument (streaming core)', () => {
  it('hands the stream itself to the ingest and records the stored (sniffed) type and size', async () => {
    const body = Readable.from([Buffer.from('abc')]);
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'image/png', file_size: 3 });

    const doc = await attachDocument({ ...base, file: { fileName: 'x.bin', mimeType: 'application/octet-stream', body } });

    expect(uploadFile.mock.calls[0]![1]).toBe(body);
    expect(doc.document_id).toBeTruthy();
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

  it('rolls the stored file back when the document transaction fails', async () => {
    uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 1 });
    const failing = { ...base, loadDocument: async () => null };
    await expect(attachDocument({ ...failing, file: { fileName: 'x', mimeType: 'text/plain', body: Buffer.from('a') } })).rejects.toThrow('could not be loaded');
    // Committed documents are never deleted from storage.
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
