import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/auth/getCurrentUser', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
    tenant: 'tenant-1',
  })),
}));

vi.mock('../src/config/storage', () => ({
  getProviderConfig: vi.fn(),
  getStorageConfig: vi.fn(),
  validateFileUpload: vi.fn(async () => {}),
}));

vi.mock('../src/storage/StorageProviderFactory', () => ({
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

import { createTenantKnex } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { StorageProviderFactory } from '../src/storage/StorageProviderFactory';
import { getProviderConfig, getStorageConfig } from '../src/config/storage';
import { FileStoreModel } from '../src/models/storage';
import { StorageService } from '../src/storage/StorageService';

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

  it('publishes DOCUMENT_DELETED after deleting the file record', async () => {
    getStorageConfigMock.mockResolvedValue({ defaultProvider: 'local' } as any);
    getProviderConfigMock.mockResolvedValue({ type: 'local' } as any);

    createProviderMock.mockResolvedValue({
      delete: vi.fn(async () => {}),
    } as any);

    createTenantKnexMock.mockResolvedValue({ knex: {} } as any);

    fileFindByIdMock
      .mockResolvedValueOnce({
        file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        original_name: 'sample.txt',
        mime_type: 'text/plain',
        file_size: 3,
        storage_path: 'tenant-1/files/sample.txt',
        uploaded_by_id: 'a836a8b5-3df5-47b1-b49b-9a78f2b1a8a0',
        created_at: '2026-01-24T12:00:00.000Z',
      } as any)
      .mockResolvedValueOnce({
        file_id: '14f1fbf4-17d6-4bdc-8d4b-0b2a2ff8f26a',
        deleted_at: '2026-01-24T12:30:00.000Z',
      } as any);

    fileSoftDeleteMock.mockResolvedValue(undefined as any);

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
