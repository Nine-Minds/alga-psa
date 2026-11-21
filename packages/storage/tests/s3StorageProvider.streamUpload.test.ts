import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';

const config: any = {
  type: 's3',
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKey: 'key',
  secretKey: 'secret',
  endpoint: 'http://localhost:9000',
};

// Mocked-SDK unit tests for how upload() drives the multipart session (the real wire
// behaviour is covered by writeSession.contract.test.ts against a real S3 endpoint).
describe('S3StorageProvider.upload via a write session', () => {
  let send: ReturnType<typeof vi.spyOn>;
  let provider: S3StorageProvider;

  beforeEach(() => {
    send = vi.spyOn(S3Client.prototype, 'send') as any;
    send.mockImplementation(async (command: any) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
      if (command instanceof UploadPartCommand) return { ETag: `"etag${command.input.PartNumber}"` };
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

  const calls = (type: any) => send.mock.calls.map(([c]: any[]) => c).filter((c: any) => c instanceof type);

  it('sets ContentLength from the part size and passes the Readable straight through', async () => {
    const stream = Readable.from([Buffer.from('hello')]);
    const handle = await provider.beginWrite('a/b.amp', { mimeType: 'application/x' });
    await provider.writePart(handle, 1, stream, 5, { final: true });
    const [part] = calls(UploadPartCommand);
    expect(part.input.ContentLength).toBe(5);
    expect(part.input.Body).toBe(stream);
    expect(part.input.UploadId).toBe('u1');
  });

  it('does not require options.size for streams; one small stream is one final part', async () => {
    const result = await provider.upload(Readable.from([Buffer.from('abc'), Buffer.from('de')]), 'a/b.amp');
    expect(calls(CreateMultipartUploadCommand)).toHaveLength(1);
    expect(calls(UploadPartCommand)).toHaveLength(1);
    expect(calls(UploadPartCommand)[0].input.ContentLength).toBe(5);
    expect(calls(CompleteMultipartUploadCommand)).toHaveLength(1);
    expect(result.size).toBe(5);
  });

  it('does not retry a Readable part on a retryable error', async () => {
    send.mockImplementation(async (command: any) => {
      if (command instanceof UploadPartCommand) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return {};
    });
    const handle = { provider: 's3', bucket: 'test-bucket', key: 'k', uploadId: 'u' } as const;
    await expect(provider.writePart(handle, 1, new PassThrough().end(Buffer.from('abcde')) as any, 5, { final: true })).rejects.toThrow('reset');
    expect(calls(UploadPartCommand)).toHaveLength(1);
  });

  it('aborts the session when a part fails', async () => {
    send.mockImplementation(async (command: any) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
      if (command instanceof UploadPartCommand) throw new Error('denied');
      return {};
    });
    await expect(provider.upload(Readable.from([Buffer.from('abcde')]), 'a/b.amp')).rejects.toThrow('denied');
    expect(calls(AbortMultipartUploadCommand)).toHaveLength(1);
  });

  it('retries parts that upload() has buffered (a Buffer can be re-sent)', async () => {
    vi.useFakeTimers();
    let failed = false;
    send.mockImplementation(async (command: any) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u1' };
      if (command instanceof UploadPartCommand) {
        if (!failed) { failed = true; throw Object.assign(new Error('reset'), { code: 'ECONNRESET' }); }
        return { ETag: '"e"' };
      }
      if (command instanceof HeadObjectCommand) return { ContentLength: 5 };
      return {};
    });
    const promise = provider.upload(Buffer.from('hello'), 'a/b.amp');
    await vi.runAllTimersAsync();
    await promise;
    expect(calls(UploadPartCommand)).toHaveLength(2);
  });

  it('rejects an invalid part size before sending', async () => {
    const handle = { provider: 's3', bucket: 'test-bucket', key: 'k', uploadId: 'u' } as const;
    for (const size of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(provider.writePart(handle, 1, Readable.from([]), size, { final: true })).rejects.toMatchObject({ code: 'INVALID_PART' });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a handle issued for a different bucket', async () => {
    const handle = { provider: 's3', bucket: 'other', key: 'k', uploadId: 'u' } as const;
    await expect(provider.abortWrite(handle)).rejects.toMatchObject({ code: 'INVALID_WRITE_HANDLE' });
  });
});
