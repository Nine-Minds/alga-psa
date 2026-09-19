import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { coManagedLifecycleMock } from '@alga-psa/db/testing';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
  })),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createTenantKnex: vi.fn(),
}));

// The lifecycle guard StorageService calls would otherwise open a real
// transaction on the stub connection. Keep the rest of licensing real.
vi.mock('@alga-psa/licensing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...coManagedLifecycleMock({ fn: vi.fn }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  isValidUUID: vi.fn(() => false),
}));

vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(async () => undefined),
}));

vi.mock('../src/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(),
  },
  generateStoragePath: vi.fn(() => 'tenant-1/files/sample.amp'),
}));

vi.mock('../src/models/storage', () => ({
  FileStoreModel: {
    create: vi.fn(),
    findById: vi.fn(),
    softDelete: vi.fn(),
    updateMetadata: vi.fn(),
  },
}));

import { createTenantKnex } from '@alga-psa/db';
import { StorageProviderFactory } from '../src/StorageProviderFactory';
import { FileStoreModel } from '../src/models/storage';
import { clearCachedStorageConfig } from '../src/config/storage';
import { StorageService } from '../src/StorageService';

const RESTRICTIVE_ALLOWLIST =
  'image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/*';

describe('StorageService provenance', () => {
  const createTenantKnexMock = vi.mocked(createTenantKnex);
  const createProviderMock = vi.mocked(StorageProviderFactory.createProvider);
  const fileCreateMock = vi.mocked(FileStoreModel.create);

  beforeEach(() => {
    clearCachedStorageConfig();
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = RESTRICTIVE_ALLOWLIST;
    delete process.env.STORAGE_LOCAL_MAX_FILE_SIZE;
    delete process.env.STORAGE_DEFAULT_PROVIDER;
    createTenantKnexMock.mockReset();
    createProviderMock.mockReset();
    fileCreateMock.mockReset();
    // Every upload path resolves a connection for lifecycle admission before it
    // looks at the MIME type, so even the reject-the-type cases need one.
    createTenantKnexMock.mockResolvedValue({ knex: {} } as any);
  });

  it('applies the allowlist when no provenance option is given (fail-closed default)', async () => {
    await expect(
      StorageService.uploadStream('tenant-1', Readable.from([Buffer.from('abc')]), 'package.amp', {
        mime_type: 'application/vnd.sqlite3',
        uploaded_by_id: 'user-1',
        size: 3,
      })
    ).rejects.toThrow('File type not allowed');
  });

  it('skips the allowlist for a system artifact', async () => {
    createProviderMock.mockResolvedValue({
      upload: vi.fn(async () => ({
        path: 'tenant-1/files/package.amp',
        size: 3,
        mime_type: 'application/vnd.sqlite3',
      })),
    } as any);
    createTenantKnexMock.mockResolvedValue({ knex: {} } as any);
    fileCreateMock.mockResolvedValue({ file_id: 'file-1' } as any);

    await expect(
      StorageService.uploadStream('tenant-1', Readable.from([Buffer.from('abc')]), 'package.amp', {
        mime_type: 'application/vnd.sqlite3',
        uploaded_by_id: 'user-1',
        size: 3,
        origin: 'system-artifact',
      })
    ).resolves.toMatchObject({ file_id: 'file-1' });

    expect(createProviderMock).toHaveBeenCalled();
  });
});
