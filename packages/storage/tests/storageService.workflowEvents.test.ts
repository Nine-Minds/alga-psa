import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  runWithTenant: (_tenant: string, work: () => Promise<unknown>) => work(),
}));

vi.mock('@alga-psa/licensing', () => ({
  CoManagedLifecycleError: class extends Error {},
  getCoManagedOperationalState: async () => ({ state: 'independent', canWrite: true, graceEndsAt: null }),
  withCoManagedOperationalTransaction: (db: unknown, _tenant: string, work: (trx: unknown) => Promise<unknown>) => work(db),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('../src/config/storage', () => ({
  getProviderConfig: vi.fn(),
  getStorageConfig: vi.fn(),
  validateFileUpload: vi.fn(async () => {}),
}));

vi.mock('../src/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(),
  },
  generateStoragePath: vi.fn(() => 'tenant-1/files/sample.txt'),
}));

vi.mock('../src/models/storage', () => ({
  FileStoreModel: {
    create: vi.fn(),
    findById: vi.fn(),
    softDelete: vi.fn(),
  },
}));

vi.mock('@alga-psa/validation', () => ({
  isValidUUID: vi.fn(() => true),
}));

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(async () => undefined),
}));

import { createTenantKnex } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { StorageProviderFactory } from '../src/StorageProviderFactory';
import { getProviderConfig, getStorageConfig, validateFileUpload } from '../src/config/storage';
import { FileStoreModel } from '../src/models/storage';
import { StorageService } from '../src/StorageService';

describe('StorageService.uploadFile workflow events', () => {
  const createTenantKnexMock = vi.mocked(createTenantKnex);
  const publishWorkflowEventMock = vi.mocked(publishWorkflowEvent);
  const createProviderMock = vi.mocked(StorageProviderFactory.createProvider);
  const getStorageConfigMock = vi.mocked(getStorageConfig);
  const getProviderConfigMock = vi.mocked(getProviderConfig);
  const fileCreateMock = vi.mocked(FileStoreModel.create);
  const fileFindByIdMock = vi.mocked(FileStoreModel.findById);
  const fileSoftDeleteMock = vi.mocked(FileStoreModel.softDelete);

  beforeEach(() => {
    publishWorkflowEventMock.mockReset();
    createProviderMock.mockReset();
    getStorageConfigMock.mockReset();
    getProviderConfigMock.mockReset();
    fileCreateMock.mockReset();
    fileFindByIdMock.mockReset();
    fileSoftDeleteMock.mockReset();
    createTenantKnexMock.mockReset();
  });

  it('publishes FILE_UPLOADED after creating the file record', async () => {
    createProviderMock.mockResolvedValue({
      upload: vi.fn(async () => ({ path: 'tenant-1/files/sample.txt' })),
    } as any);

    createTenantKnexMock.mockResolvedValue({ knex: {} } as any);

    fileCreateMock.mockResolvedValue({
      file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
      original_name: 'sample.txt',
      mime_type: 'text/plain',
      file_size: 3,
      storage_path: 'tenant-1/files/sample.txt',
      uploaded_by_id: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
      created_at: '2026-01-24T12:00:00.000Z',
    } as any);

    await StorageService.uploadFile('tenant-1', Buffer.from('abc'), 'sample.txt', {
      mime_type: 'text/plain',
      uploaded_by_id: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
    });

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_UPLOADED',
        payload: expect.objectContaining({
          documentId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
          uploadedByUserId: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
          uploadedAt: '2026-01-24T12:00:00.000Z',
          fileName: 'sample.txt',
          contentType: 'text/plain',
          sizeBytes: 3,
          storageKey: 'tenant-1/files/sample.txt',
        }),
        ctx: expect.objectContaining({ tenantId: 'tenant-1' }),
      })
    );

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'FILE_UPLOADED',
        payload: expect.objectContaining({
          fileId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
          fileName: 'sample.txt',
          contentType: 'text/plain',
          sizeBytes: 3,
          storageKey: 'tenant-1/files/sample.txt',
        }),
        ctx: expect.objectContaining({ tenantId: 'tenant-1' }),
      })
    );
  });

  it('passes a verified stream length to transport and removes a mismatched receipt before persisting', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: {} } as any);
    const upload = vi.fn(async (stream: Readable, path: string, options: { content_length: number }) => {
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(options.content_length).toBe(Buffer.concat(chunks).length);
      return { path, size: 3, mime_type: 'text/plain' };
    }), remove = vi.fn();
    createProviderMock.mockResolvedValue({ upload, delete: remove } as any);
    fileCreateMock.mockResolvedValue({ file_id: 'stored-stream' } as any);
    await expect(StorageService.uploadStream('tenant-1', Readable.from([Buffer.from('abc')]), 'sample.txt',
      { uploaded_by_id: 'user-1', size: 3, mime_type: 'text/plain' })).resolves.toMatchObject({ file_id: 'stored-stream' });
    expect(fileCreateMock).toHaveBeenCalledTimes(1);
    upload.mockResolvedValueOnce({ path: 'tenant-1/files/mismatch', size: 2, mime_type: 'text/plain' });
    await expect(StorageService.uploadStream('tenant-1', Readable.from([Buffer.from('abc')]), 'sample.txt',
      { uploaded_by_id: 'user-1', size: 3 })).rejects.toThrow('declared size');
    expect(remove).toHaveBeenCalledWith('tenant-1/files/mismatch');
    expect(fileCreateMock).toHaveBeenCalledTimes(1);
  });

  it('publishes DOCUMENT_DELETED after deleting the file record', async () => {
    getStorageConfigMock.mockResolvedValue({ defaultProvider: 'local' } as any);
    getProviderConfigMock.mockResolvedValue({ type: 'local' } as any);

    createProviderMock.mockResolvedValue({
      delete: vi.fn(async () => {}),
    } as any);

    createTenantKnexMock.mockResolvedValue({ knex: {}, tenant: 'tenant-1' } as any);

    fileFindByIdMock
      .mockResolvedValueOnce({
        file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        original_name: 'sample.txt',
        mime_type: 'text/plain',
        file_size: 3,
        storage_path: 'tenant-1/files/sample.txt',
        uploaded_by_id: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
        created_at: '2026-01-24T12:00:00.000Z',
      } as any);

    fileSoftDeleteMock.mockResolvedValue({
      file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
      deleted_at: '2026-01-24T12:30:00.000Z',
    } as any);

    await StorageService.deleteFile(
      '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
      'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0'
    );

    expect(publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DOCUMENT_DELETED',
        payload: expect.objectContaining({
          documentId: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
          deletedByUserId: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
          deletedAt: '2026-01-24T12:30:00.000Z',
        }),
        ctx: expect.objectContaining({ tenantId: 'tenant-1' }),
      })
    );
  });
});

it('awaits configured upload validation and propagates a denied file before returning success', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  vi.mocked(validateFileUpload).mockReturnValueOnce(pending);
  let settled = false;
  const result = StorageService.validateFileUpload('tenant', 'text/plain', 50).finally(() => { settled = true; });
  const assertion = expect(result).rejects.toThrow('File type not allowed');
  await Promise.resolve(); expect(settled).toBe(false);
  reject(new Error('File type not allowed')); await assertion;
});
