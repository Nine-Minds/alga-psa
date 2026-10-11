import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';

const config: any = {
  type: 's3',
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKey: 'key',
  secretKey: 'secret',
  endpoint: 'http://localhost:9000',
};

describe('S3StorageProvider.upload with stream bodies', () => {
  let send: ReturnType<typeof vi.spyOn>;
  let provider: S3StorageProvider;

  beforeEach(() => {
    send = vi.spyOn(S3Client.prototype, 'send') as any;
    send.mockImplementation(async (command: any) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 5, ContentType: 'application/octet-stream', Metadata: {} };
      }
      return {};
    });
    provider = new S3StorageProvider(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const putCalls = () => send.mock.calls.filter(([c]: any[]) => c instanceof PutObjectCommand);

  it('sets ContentLength from options.size for a Readable body', async () => {
    const stream = new PassThrough();
    const result = await provider.upload(stream, 'a/b.amp', { mime_type: 'application/x', size: 5 });
    expect(putCalls()).toHaveLength(1);
    expect((putCalls()[0][0] as PutObjectCommand).input.ContentLength).toBe(5);
    expect((putCalls()[0][0] as PutObjectCommand).input.Body).toBe(stream);
    expect(result.size).toBe(5);
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a stream body with invalid size %s before sending',
    async (size) => {
      await expect(provider.upload(Readable.from([Buffer.from('abc')]), 'a/b.amp', { size })).rejects.toThrow(
        /requires options\.size/,
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('does not retry a stream PUT on a retryable error', async () => {
    send.mockRejectedValue(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    await expect(provider.upload(new PassThrough(), 'a/b.amp', { size: 5 })).rejects.toThrow('reset');
    expect(putCalls()).toHaveLength(1);
  });

  it('still retries Buffer PUTs and does not set ContentLength', async () => {
    vi.useFakeTimers();
    send.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    const promise = provider.upload(Buffer.from('hello'), 'a/b.amp');
    await vi.runAllTimersAsync();
    await promise;
    expect(putCalls()).toHaveLength(2);
    expect((putCalls()[1][0] as PutObjectCommand).input.ContentLength).toBeUndefined();
  });
});
