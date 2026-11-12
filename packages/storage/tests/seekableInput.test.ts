import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';
import { LocalStorageProvider } from '../src/providers/LocalStorageProvider';

describe('provider seekable input for ffmpeg', () => {
  it('S3 signs a GET URL on the configured internal endpoint (path-style bucket + key)', async () => {
    const provider = new S3StorageProvider({
      type: 's3', region: 'us-east-1', bucket: 'alga-docs', accessKey: 'ak', secretKey: 'sk',
      endpoint: 'http://minio.internal:9000', maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30,
    });

    const input = await provider.getSeekableInput('tenant/videos/a b.mp4', 600);

    expect(input.kind).toBe('url');
    const url = new URL((input as { url: string }).url);
    expect(url.origin).toBe('http://minio.internal:9000');
    expect(url.pathname).toBe('/alga-docs/tenant/videos/a%20b.mp4');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('Local returns the absolute file path and rejects missing files', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'local-seekable-'));
    try {
      await writeFile(path.join(base, 'v.mp4'), 'x');
      const provider = new LocalStorageProvider({
        type: 'local', basePath: base, maxFileSize: 1024, allowedMimeTypes: ['*/*'], retentionDays: 30,
      });

      expect(await provider.getSeekableInput('v.mp4', 60)).toEqual({ kind: 'file', path: path.join(base, 'v.mp4') });
      await expect(provider.getSeekableInput('missing.mp4', 60)).rejects.toThrow('File not found');
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
