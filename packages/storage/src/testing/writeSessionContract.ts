/**
 * Test-only: the resumable write-session contract every StorageProvider must satisfy, defined
 * once and run once per provider. Not a package export (no tsup entry); test files reach it
 * through the `@alga-psa/storage/*` source alias, and production code must not import it.
 *
 * Runners:
 *  - packages/storage/tests/writeSession.contract.test.ts — local provider (unit lane).
 *  - ee/server/src/lib/storage/providers/__tests__/s3WriteSession.integration.test.ts — S3 provider
 *    against the real MinIO service of the workspace-runtime lane.
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
import { LocalStorageProvider } from '../providers/LocalStorageProvider';
import {
  MIN_NON_FINAL_PART_SIZE,
  StorageError,
  type PartReceipt,
  type StorageProviderInterface,
} from '../providers/StorageProvider';
import type { LocalProviderConfig, S3ProviderConfig } from '../types/storage';

const MiB = 1024 * 1024;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export interface WriteSessionHarness {
  /** Provider type under test ('local' | 's3'); also the provider discriminator of its handles. */
  name: 'local' | 's3';
  /** Returns a *fresh* provider instance on every call (stands in for another pod). */
  make(): StorageProviderInterface;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  /** Asserts no object and no in-progress session state remain for `key`. */
  assertNothingPending(key: string): Promise<void>;
}

export function localWriteSessionHarness(): WriteSessionHarness {
  let dir = '';
  const config = (): LocalProviderConfig => ({
    type: 'local',
    basePath: dir,
    maxFileSize: 1 << 30,
    allowedMimeTypes: ['*/*'],
    retentionDays: 30,
  });
  return {
    name: 'local',
    make: () => new LocalStorageProvider(config()),
    setup: async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-session-'));
    },
    teardown: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
    assertNothingPending: async (key) => {
      const entries = await fs.readdir(path.dirname(path.join(dir, key))).catch(() => [] as string[]);
      expect(entries.filter((e) => e.includes('.partial'))).toEqual([]);
      expect(entries.filter((e) => e === path.basename(key))).toEqual([]);
    },
  };
}

export interface S3WriteSessionTarget {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/**
 * `createProvider` is injected so callers can exercise the provider through the seam they ship
 * (the EE registration re-export) rather than only the package class.
 */
export function s3WriteSessionHarness(
  target: () => S3WriteSessionTarget,
  createProvider: (config: S3ProviderConfig) => StorageProviderInterface,
): WriteSessionHarness {
  let resolved: S3WriteSessionTarget | null = null;
  const current = () => {
    if (!resolved) throw new Error('S3 write-session harness used before setup()');
    return resolved;
  };
  const rawClient = () => {
    const t = current();
    return new S3Client({
      region: t.region,
      endpoint: t.endpoint,
      forcePathStyle: Boolean(t.endpoint),
      credentials: { accessKeyId: t.accessKey, secretAccessKey: t.secretKey },
    });
  };
  return {
    name: 's3',
    make: () => {
      const t = current();
      return createProvider({
        type: 's3',
        region: t.region,
        bucket: t.bucket,
        accessKey: t.accessKey,
        secretKey: t.secretKey,
        endpoint: t.endpoint,
        maxFileSize: 1 << 30,
        allowedMimeTypes: ['*/*'],
        retentionDays: 30,
      });
    },
    setup: async () => {
      resolved = target();
      await rawClient()
        .send(new CreateBucketCommand({ Bucket: resolved.bucket }))
        .catch((e) => {
          if (!/BucketAlready/.test(e?.name)) throw e;
        });
    },
    teardown: async () => {},
    assertNothingPending: async (key) => {
      const client = rawClient();
      const { bucket } = current();
      const listed = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }));
      expect((listed.Uploads ?? []).filter((u) => u.Key === key)).toEqual([]);
      await expect(client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
    },
  };
}

function* chunks(buf: Buffer, n: number) {
  for (let o = 0; o < buf.length; o += n) yield buf.subarray(o, o + n);
}

/** Registers the shared contract suite for one provider. */
export function defineWriteSessionContract(h: WriteSessionHarness): void {
  describe(`write sessions: '${h.name}' contract`, () => {
    beforeAll(() => h.setup());
    afterAll(() => h.teardown());

    // part sizes: two non-final parts >= 5 MiB and a short final part
    const sizes = [MIN_NON_FINAL_PART_SIZE, MIN_NON_FINAL_PART_SIZE + 17, 123];
    const parts = sizes.map((n) => randomBytes(n));
    const whole = Buffer.concat(parts);
    const key = (n: string) =>
      `write-session-contract/${h.name}/${n}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
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
      const other = h.name === 's3'
        ? { provider: 'local', path: 'a', partialPath: 'a.x.partial' }
        : { provider: 's3', bucket: 'b', key: 'a', uploadId: 'u' };
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
}
