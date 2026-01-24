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
  },
}));

import { createTenantKnex } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { StorageProviderFactory } from '../src/storage/StorageProviderFactory';
import { FileStoreModel } from '../src/models/storage';
import { StorageService } from '../src/storage/StorageService';

describe('StorageService.uploadFile workflow events', () => {
  const createTenantKnexMock = vi.mocked(createTenantKnex);
  const publishWorkflowEventMock = vi.mocked(publishWorkflowEvent);
  const createProviderMock = vi.mocked(StorageProviderFactory.createProvider);
  const fileCreateMock = vi.mocked(FileStoreModel.create);

  beforeEach(() => {
    publishWorkflowEventMock.mockReset();
    createProviderMock.mockReset();
    fileCreateMock.mockReset();
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
});
