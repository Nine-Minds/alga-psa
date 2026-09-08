import { afterEach, expect, it, vi } from 'vitest';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';
import type { S3ProviderConfig } from '../src/types/storage';

const config = (): S3ProviderConfig => ({ type: 's3', region: 'us-east-1', bucket: 'fixture', accessKey: 'fixture', secretKey: 'fixture',
  maxFileSize: 1024, allowedMimeTypes: ['image/*'], retentionDays: 30 });
const reset = () => Object.assign(new Error('fixture network error'), { code: 'ECONNRESET' });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('exposes configured upload restrictions within its single-object transport limit', () => {
  const provider = new S3StorageProvider(config());
  const capabilities = provider.getCapabilities();
  expect(capabilities).toMatchObject({ maxFileSize: 1024, allowedMimeTypes: ['image/*'] });
  capabilities.allowedMimeTypes!.push('*/*');
  expect(provider.getCapabilities().allowedMimeTypes).toEqual(['image/*']);
  expect(new S3StorageProvider({ ...config(), maxFileSize: 10 * 1024 ** 3 }).getCapabilities().maxFileSize).toBe(5 * 1024 ** 3);
  expect(new S3StorageProvider({ ...config(), allowedMimeTypes: [] }).getCapabilities().allowedMimeTypes).toEqual([]);
});
it.each([NaN, -1, Infinity])('rejects an invalid configured size restriction (%s)', maxFileSize => {
  expect(() => new S3StorageProvider({ ...config(), maxFileSize }).getCapabilities()).toThrow('limit is invalid');
});
it('never retries a consumed stream after a retryable PUT failure', async () => {
  const source = Readable.from([Buffer.from('customer bytes')]), received: Buffer[] = [];
  const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
    expect(command).toBeInstanceOf(PutObjectCommand);
    for await (const chunk of command.input.Body) received.push(Buffer.from(chunk));
    throw reset();
  });
  await expect(new S3StorageProvider(config()).upload(source, 'restore/object')).rejects.toMatchObject({ operation: 'upload', code: 'ECONNRESET' });
  expect(Buffer.concat(received).toString()).toBe('customer bytes');
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects invalid or mismatched declared buffer lengths before any provider request', async () => {
  const send = vi.spyOn(S3Client.prototype, 'send'), provider = new S3StorageProvider(config());
  for (const content_length of [-1, NaN, 2]) {
    await expect(provider.upload(Buffer.from('hello'), 'restore/object', { content_length })).rejects.toThrow('content length is invalid');
  }
  expect(send).not.toHaveBeenCalled();
});
it('retries a failed receipt read without repeating the successful streaming PUT', async () => {
  vi.useFakeTimers(); let puts = 0, heads = 0;
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
    if (command instanceof PutObjectCommand) {
      puts++; for await (const _chunk of command.input.Body as Readable) { /* consume once */ }
      return {};
    }
    expect(command).toBeInstanceOf(HeadObjectCommand);
    if (++heads === 1) throw reset();
    return { ContentLength: 5, ContentType: 'text/plain' };
  });
  const result = new S3StorageProvider(config()).upload(Readable.from([Buffer.from('hello')]), 'restore/object');
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ path: 'restore/object', size: 5, mime_type: 'text/plain' });
  expect(puts).toBe(1); expect(heads).toBe(2);
});
it('can replay buffer PUTs after a transient failure', async () => {
  vi.useFakeTimers(); let puts = 0;
  const bytes = Buffer.from('replayable');
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
    if (command instanceof PutObjectCommand) {
      expect(command.input.Body).toBe(bytes); if (++puts === 1) throw reset(); return {};
    }
    return { ContentLength: bytes.length };
  });
  const result = new S3StorageProvider(config()).upload(bytes, 'restore/object');
  await vi.runAllTimersAsync(); expect((await result).size).toBe(bytes.length); expect(puts).toBe(2);
});
