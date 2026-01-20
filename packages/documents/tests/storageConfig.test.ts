import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
  })),
}));

import { clearCachedStorageConfig, getStorageConfig, validateFileUpload } from '../src/config/storage';

describe('documents storage config', () => {
  beforeEach(() => {
    clearCachedStorageConfig();

    delete process.env.STORAGE_DEFAULT_PROVIDER;
    delete process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES;
    delete process.env.STORAGE_LOCAL_MAX_FILE_SIZE;
    delete process.env.STORAGE_S3_ALLOWED_MIME_TYPES;
    delete process.env.STORAGE_S3_MAX_FILE_SIZE;
  });

  it('defaults to local provider with */* allowlist', async () => {
    const config = await getStorageConfig();
    expect(config.defaultProvider).toBe('local');
    expect(config.providers.local.allowedMimeTypes).toContain('*/*');

    await expect(validateFileUpload('application/pdf', 1)).resolves.toBeUndefined();
  });

  it('rejects files larger than maxFileSize', async () => {
    process.env.STORAGE_LOCAL_MAX_FILE_SIZE = '10';
    await expect(validateFileUpload('text/plain', 11)).rejects.toThrow(/File size exceeds limit/);
  });

  it('enforces mime allowlist with wildcard prefixes', async () => {
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = 'image/*';
    await expect(validateFileUpload('image/png', 1)).resolves.toBeUndefined();
    await expect(validateFileUpload('application/pdf', 1)).rejects.toThrow('File type not allowed');
  });
});

