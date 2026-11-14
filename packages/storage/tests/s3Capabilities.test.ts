import { describe, expect, it } from 'vitest';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';

const provider = (maxFileSize: number) =>
  new S3StorageProvider({ type: 's3', region: 'us-east-1', bucket: 'b', accessKey: 'k', secretKey: 's', maxFileSize, allowedMimeTypes: ['*/*'], retentionDays: 30 });

describe('S3 provider capability vs the configured upload limit', () => {
  it('reports the configured limit when it is below the S3 object ceiling (the configured limit wins)', () => {
    expect(provider(524288000).getCapabilities().maxFileSize).toBe(524288000);
  });

  it('never reports more than S3 itself can store', () => {
    expect(provider(10 * 1024 ** 4).getCapabilities().maxFileSize).toBe(5 * 1024 ** 3);
  });
});
