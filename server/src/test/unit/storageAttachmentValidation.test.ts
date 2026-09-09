import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from '@alga-psa/storage/StorageService';
import { clearCachedStorageConfig } from '../../../../packages/storage/src/config/storage';

vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined }) }));

afterEach(() => { vi.unstubAllEnvs(); clearCachedStorageConfig(); });
describe('attachment storage policy', () => {
  it('propagates asynchronous size and MIME rejection from pre-validation', async () => {
    vi.stubEnv('STORAGE_DEFAULT_PROVIDER', 'local');
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf,video/*');
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '100');
    clearCachedStorageConfig();
    await expect(StorageService.validateFileUpload('tenant', 'application/pdf', 101)).rejects.toThrow('size exceeds');
    await expect(StorageService.validateFileUpload('tenant', 'application/x-msdownload', 10)).rejects.toThrow('not allowed');
    await expect(StorageService.validateFileUpload('tenant', 'videoevil/executable', 10)).rejects.toThrow('not allowed');
    await expect(StorageService.validateFileUpload('tenant', 'video/webm', 10)).resolves.toBeUndefined();
    await expect(StorageService.validateFileUpload('tenant', 'application/pdf', 10)).resolves.toBeUndefined();
  });
  it('preserves explicitly unrestricted Documents policy', async () => {
    vi.stubEnv('STORAGE_DEFAULT_PROVIDER', 'local');
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    clearCachedStorageConfig();
    await expect(StorageService.validateFileUpload('tenant', 'application/octet-stream', 10)).resolves.toBeUndefined();
  });
});
