/**
 * Contract suite for resumable multipart write sessions, run against every provider.
 *
 * The S3 leg needs a real S3-compatible endpoint (MinIO, moto_server, ...). It is skipped LOUDLY
 * unless STORAGE_TEST_S3_ENDPOINT, STORAGE_TEST_S3_ACCESS_KEY and STORAGE_TEST_S3_SECRET_KEY are set
 * (optional: STORAGE_TEST_S3_BUCKET, STORAGE_TEST_S3_REGION). The bucket is created in setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { LocalStorageProvider } from '../src/providers/LocalStorageProvider';
import { S3StorageProvider } from '../src/providers/S3StorageProvider';
import {
  MIN_NON_FINAL_PART_SIZE,
  StorageError,
  type PartReceipt,
  type StorageProviderInterface,
} from '../src/providers/StorageProvider';

const MiB = 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Harness {
  name: string;
  make(): StorageProviderInterface; // a *fresh* instance every call
  assertNothingPending(key: string): Promise<void>;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  skip?: string;
}

function localHarness(): Harness {
  let dir = '';
  const config = () => ({ type: 'local' as const, basePath: dir, maxFileSize: 1 << 30, allowedMimeTypes: ['*/*'], retentionDays: 30 });
  return {
    name: 'local',
    make: () => new LocalStorageProvider(config() as any),
    setup: async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-session-')); },
    teardown: async () => { await fs.rm(dir, { recursive: true, force: true }); },
    assertNothingPending: async (key) => {
      const entries = await fs.readdir(path.dirname(path.join(dir, key))).catch(() => [] as string[]);
      expect(entries.filter((e) => e.includes('.partial'))).toEqual([]);
      expect(entries.filter((e) => e === path.basename(key))).toEqual([]);
    },
  };
}

function s3Harness(): Harness {
  const endpoint = process.env.STORAGE_TEST_S3_ENDPOINT;
  const accessKey = process.env.STORAGE_TEST_S3_ACCESS_KEY;
  const secretKey = process.env.STORAGE_TEST_S3_SECRET_KEY;
  const bucket = process.env.STORAGE_TEST_S3_BUCKET || `write-session-${Date.now()}`;
  const region = process.env.STORAGE_TEST_S3_REGION || 'us-east-1';
  const skip = endpoint && accessKey && secretKey ? undefined
    : 'STORAGE_TEST_S3_ENDPOINT / STORAGE_TEST_S3_ACCESS_KEY / STORAGE_TEST_S3_SECRET_KEY not set';
  if (skip) console.warn(`\n!!! SKIPPING S3 write-session contract tests against a real endpoint: ${skip} !!!\n`);
  const config = { type: 's3' as const, region, bucket, accessKey, secretKey, endpoint, maxFileSize: 1 << 30, allowedMimeTypes: ['*/*'], retentionDays: 30 };
  const raw = () => new S3Client({ region, endpoint, forcePathStyle: true, credentials: { accessKeyId: accessKey!, secretAccessKey: secretKey! } });
  return {
    name: 's3',
    skip,
    make: () => new S3StorageProvider(config as any),
    setup: async () => {
      await raw().send(new CreateBucketCommand({ Bucket: bucket })).catch((e) => {
        if (!/BucketAlready/.test(e?.name)) throw e;
      });
    },
    teardown: async () => {},
    assertNothingPending: async (key) => {
      const client = raw();
      const listed = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }));
      expect((listed.Uploads ?? []).filter((u) => u.Key === key)).toEqual([]);
      await expect(client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
    },
  };
}

const harnesses = [localHarness(), s3Harness()];

describe.each(harnesses)('write sessions: $name', (h) => {
  const run = h.skip ? describe.skip : describe;
  run('contract', () => {
    beforeAll(() => h.setup());
    afterAll(() => h.teardown());

    // part sizes: two non-final parts >= 5 MiB and a short final part
    const sizes = [MIN_NON_FINAL_PART_SIZE, MIN_NON_FINAL_PART_SIZE + 17, 123];
    const parts = sizes.map((n) => randomBytes(n));
    const whole = Buffer.concat(parts);
    const key = (n: string) => `tenant/${h.name}/${n}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
    const write = (p: StorageProviderInterface, handle: any, i: number) =>
      p.writePart(handle, i + 1, Readable.from([parts[i]]), parts[i].length, { final: i === parts.length - 1 });

    it('multi-part write yields exact bytes and size', async () => {
      const p = h.make();
      const k = key('multi');
      const handle = await p.beginWrite(k, { mimeType: 'application/x-test', metadata: { a: 'b' } });
      const receipts: PartReceipt[] = [];
      for (let i = 0; i < parts.length; i++) receipts.push(await write(p, handle, i));
      const result = await p.completeWrite(handle, receipts);
      expect(result).toMatchObject({ path: k, size: whole.length, mime_type: 'application/x-test', metadata: { a: 'b' } });
      expect(sha(await p.download(k))).toBe(sha(whole));
    });

    it('accepts out-of-order parts (3, 1, 2)', async () => {
      const p = h.make();
      const k = key('ooo');
      const handle = await p.beginWrite(k, {});
      const receipts = [] as PartReceipt[];
      for (const i of [2, 0, 1]) receipts.push(await write(p, handle, i));
      const result = await p.completeWrite(handle, receipts);
      expect(result.size).toBe(whole.length);
      expect(sha(await p.download(k))).toBe(sha(whole));
    });

    it('abort leaves nothing behind and is idempotent', async () => {
      const p = h.make();
      const k = key('abort');
      const handle = await p.beginWrite(k, {});
      await write(p, handle, 0);
      await write(p, handle, 2);
      await p.abortWrite(handle);
      await p.abortWrite(handle);
      await h.assertNothingPending(k);
    });

    it('resumes from a new provider instance using only serialised handle and receipts', async () => {
      const k = key('resume');
      const a = h.make();
      const handle = await a.beginWrite(k, { mimeType: 'text/plain' });
      const r1 = roundTrip(await write(a, handle, 0));
      const wire = roundTrip(handle);

      const b = h.make();
      const r2 = roundTrip(await write(b, wire, 1));
      const c = h.make();
      const r3 = roundTrip(await write(c, wire, 2));
      const result = await h.make().completeWrite(roundTrip(wire), [r3, r1, r2]);
      expect(result).toMatchObject({ size: whole.length, mime_type: 'text/plain' });
      expect(sha(await h.make().download(k))).toBe(sha(whole));

      // abort from a fresh instance as well
      const k2 = key('resume-abort');
      const h2 = roundTrip(await a.beginWrite(k2, {}));
      await write(b, h2, 0);
      await c.abortWrite(h2);
      await h.assertNothingPending(k2);
    });

    it('enforces the 5 MiB minimum for non-final parts inside writePart', async () => {
      const p = h.make();
      const k = key('min');
      const handle = await p.beginWrite(k, {});
      const small = randomBytes(MIN_NON_FINAL_PART_SIZE - 1);
      await expect(p.writePart(handle, 1, Readable.from([small]), small.length)).rejects.toMatchObject({ code: 'PART_TOO_SMALL' });
      // a short part is legal when declared final, but then it must be the highest part at complete
      const shortFinal = await p.writePart(handle, 1, Readable.from([small]), small.length, { final: true });
      const big = randomBytes(MIN_NON_FINAL_PART_SIZE);
      const second = await p.writePart(handle, 2, Readable.from([big]), big.length, { final: true });
      await expect(p.completeWrite(handle, [shortFinal, second])).rejects.toMatchObject({ code: 'INVALID_PARTS' });
      await expect(p.completeWrite(handle, [second])).rejects.toMatchObject({ code: 'INVALID_PARTS' }); // gap: part 1 missing
      await p.abortWrite(handle);
      await h.assertNothingPending(k);
    });

    it('upload() of a Buffer, an unsized stream, and a stream larger than one part gives exact bytes', async () => {
      const p = h.make();
      const small = randomBytes(1000);
      const k1 = key('buf');
      expect(await p.upload(small, k1, { mime_type: 'image/png', metadata: { x: 'y' } })).toMatchObject({
        path: k1, size: 1000, mime_type: 'image/png', metadata: { x: 'y' },
      });
      expect(sha(await p.download(k1))).toBe(sha(small));

      const k2 = key('stream-nosize');
      await p.upload(Readable.from([small.subarray(0, 400), small.subarray(400)]), k2);
      expect(sha(await p.download(k2))).toBe(sha(small));

      const big = randomBytes(20 * MiB + 5);
      const k3 = key('stream-big');
      const res = await p.upload(Readable.from(chunks(big, 1 * MiB + 3)), k3);
      expect(res.size).toBe(big.length);
      expect(sha(await p.download(k3))).toBe(sha(big));

      const k4 = key('empty');
      expect((await p.upload(Buffer.alloc(0), k4)).size).toBe(0);
    });

    it('failed upload() aborts the session', async () => {
      const p = h.make();
      const k = key('fail');
      const bad = new Readable({ read() { this.destroy(new Error('boom')); } });
      await expect(p.upload(bad, k)).rejects.toThrow('boom');
      await h.assertNothingPending(k);
    });

    it('rejects a handle of the wrong provider type with a StorageError', async () => {
      const p = h.make();
      const other = h.name === 's3' ? { provider: 'local', path: 'a', partialPath: 'a.x.partial' } : { provider: 's3', bucket: 'b', key: 'a', uploadId: 'u' };
      const body = Readable.from([Buffer.from('x')]);
      for (const call of [
        () => p.writePart(other as any, 1, body, 1, { final: true }),
        () => p.completeWrite(other as any, []),
        () => p.abortWrite(other as any),
      ]) {
        const err = await call().catch((e) => e);
        expect(err).toBeInstanceOf(StorageError);
        expect(err.code).toBe('WRITE_HANDLE_PROVIDER_MISMATCH');
      }
    });
  });
});

function* chunks(buf: Buffer, n: number) {
  for (let o = 0; o < buf.length; o += n) yield buf.subarray(o, o + n);
}

describe('local write session path safety', () => {
  it('rejects handles whose paths escape basePath or point at foreign files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-session-esc-'));
    try {
      const p = new LocalStorageProvider({ type: 'local', basePath: dir } as any);
      await expect(p.beginWrite('../evil', {})).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
      const body = Readable.from([Buffer.from('x')]);
      for (const handle of [
        { provider: 'local', path: '../x', partialPath: '../x.a.partial' },
        { provider: 'local', path: 'a/b', partialPath: '../../etc/passwd' },
        { provider: 'local', path: 'a/b', partialPath: 'a/other.file' },
        { provider: 'local', path: '/abs', partialPath: '/abs.a.partial' },
      ]) {
        await expect(p.abortWrite(handle as any)).rejects.toMatchObject({ code: expect.stringMatching(/PATH_TRAVERSAL|INVALID_WRITE_HANDLE/) });
        await expect(p.writePart(handle as any, 1, body, 1, { final: true })).rejects.toBeInstanceOf(StorageError);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
