import { createHash } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromBuffer } from 'file-type';

import {
  DEFAULT_PART_SIZE,
  type PartReceipt,
  type StorageProviderInterface,
  type UploadResult,
  type WriteSessionHandle,
} from '../providers/StorageProvider';
import { UploadSizeLimitError } from './errors';
import { resolveUploadMime } from './mime';

/** Bytes of the stream head handed to file-type. */
export const SNIFF_HEAD_BYTES = 4100;

const asBuffer = (chunk: unknown): Buffer =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);

/** Counts bytes and fails the moment the running total passes `limit`. */
export interface ByteCounter extends Transform {
  readonly bytes: number;
}
export function byteCounter(limit: number): ByteCounter {
  let bytes = 0;
  const stage = new Transform({
    transform(chunk, _enc, cb) {
      bytes += asBuffer(chunk).length;
      if (bytes > limit) return cb(new UploadSizeLimitError(limit));
      cb(null, chunk);
    },
  }) as ByteCounter;
  Object.defineProperty(stage, 'bytes', { get: () => bytes });
  return stage;
}

/**
 * Holds back the first ~4 KB, runs file-type on it and lets `decide` accept (return) or
 * reject (throw) before any byte moves downstream; then passes everything through.
 */
export interface SniffHead extends Transform {
  readonly detectedMime: string | undefined;
  readonly resolvedMime: string | undefined;
}
export function sniffHead(decide: (detectedMime: string | undefined, info: { empty: boolean }) => string): SniffHead {
  let head: Buffer[] = [];
  let headBytes = 0;
  let decided = false;
  let detectedMime: string | undefined;
  let resolvedMime: string | undefined;

  const decideNow = async () => {
    decided = true;
    const buf = Buffer.concat(head, headBytes);
    head = [];
    detectedMime = (await fileTypeFromBuffer(new Uint8Array(buf)))?.mime;
    resolvedMime = decide(detectedMime, { empty: buf.length === 0 });
    return buf;
  };

  const stage = new Transform({
    transform(chunk, _enc, cb) {
      if (decided) return cb(null, chunk);
      const buf = asBuffer(chunk);
      head.push(buf);
      headBytes += buf.length;
      if (headBytes < SNIFF_HEAD_BYTES) return cb();
      decideNow().then((all) => cb(null, all), cb);
    },
    flush(cb) {
      if (decided) return cb();
      decideNow().then((all) => cb(null, all.length ? all : undefined), cb);
    },
  }) as SniffHead;
  Object.defineProperty(stage, 'detectedMime', { get: () => detectedMime });
  Object.defineProperty(stage, 'resolvedMime', { get: () => resolvedMime });
  return stage;
}

/** Running sha256 of the bytes passing through. */
export interface Sha256Stage extends Transform {
  /** Hex digest; valid once the stage has finished. */
  digest(): string;
}
export function sha256Stage(): Sha256Stage {
  const hash = createHash('sha256');
  let hex: string | undefined;
  const stage = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      hex = hash.digest('hex');
      cb();
    },
  }) as Sha256Stage;
  stage.digest = () => {
    if (hex === undefined) throw new Error('sha256 is not available until the stream has ended');
    return hex;
  };
  return stage;
}

/**
 * Terminal stage that deliberately buffers the whole stream (for callers like sharp that need
 * the full image), capped at `maxBytes`; past the cap it fails with the same size error.
 */
export interface Collect extends Writable {
  /** The collected bytes; valid once the stage has finished. */
  buffer(): Buffer;
}
export function collect(maxBytes: number): Collect {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const stage = new Writable({
    write(chunk, _enc, cb) {
      const buf = asBuffer(chunk);
      bytes += buf.length;
      if (bytes > maxBytes) return cb(new UploadSizeLimitError(maxBytes));
      chunks.push(buf);
      cb();
    },
  }) as Collect;
  stage.buffer = () => Buffer.concat(chunks, bytes);
  return stage;
}

/**
 * The one wrapper around a provider write session. Owns part numbering, the 5 MiB minimum for
 * non-final parts (the last part goes out with `{ final: true }`), the receipts, and
 * `abortWrite` on any error. At most one part (plus the chunk in flight) is held in memory.
 */
export interface WriteSessionSink {
  write(chunk: Buffer): Promise<void>;
  commit(): Promise<UploadResult>;
  /** Idempotent; a no-op after a successful commit. Never throws. */
  abort(): Promise<void>;
}
export function openWriteSessionSink(
  provider: StorageProviderInterface,
  path: string,
  /** Evaluated when the session opens, i.e. on the first byte, after upstream stages have decided the MIME. */
  options: () => { mimeType?: string; metadata?: Record<string, string> } = () => ({}),
  partSize: number = DEFAULT_PART_SIZE
): WriteSessionSink {
  let handle: WriteSessionHandle | undefined;
  const ensureOpen = async (): Promise<WriteSessionHandle> => {
    if (!handle) handle = await provider.beginWrite(path, options());
    return handle;
  };
  const receipts: PartReceipt[] = [];
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let state: 'open' | 'committed' | 'aborted' = 'open';

  const sendPart = async (data: Buffer, final: boolean) => {
    const h = await ensureOpen();
    receipts.push(await provider.writePart(h, receipts.length + 1, data, data.length, { final }));
  };

  // Operations in flight; abort waits for them so it cannot race a part or the session opening.
  let inflight: Promise<unknown> = Promise.resolve();
  const track = <T>(op: () => Promise<T>): Promise<T> => {
    const p = op();
    inflight = p.catch(() => undefined);
    return p;
  };

  const discard = async () => {
    if (state !== 'open') return;
    state = 'aborted';
    if (handle) await provider.abortWrite(handle).catch(() => undefined);
  };
  const abort = async () => {
    await inflight;
    await discard();
  };

  return {
    write: (chunk) => track(async () => {
      if (state !== 'open') throw new Error('Write session is closed');
      pending.push(chunk);
      pendingBytes += chunk.length;
      // A part is only sent once more bytes are known to follow, so the last part
      // can always be sent as the final one.
      while (pendingBytes > partSize) {
        const joined = Buffer.concat(pending, pendingBytes);
        const rest = Buffer.from(joined.subarray(partSize));
        pending = [rest];
        pendingBytes = rest.length;
        await sendPart(joined.subarray(0, partSize), false);
      }
    }),
    commit: () => track(async () => {
      if (state !== 'open') throw new Error('Write session is closed');
      try {
        await sendPart(Buffer.concat(pending, pendingBytes), true);
        pending = [];
        const result = await provider.completeWrite(await ensureOpen(), receipts);
        state = 'committed';
        return result;
      } catch (error) {
        await discard();
        throw error;
      }
    }),
    abort,
  };
}

/**
 * Terminal Writable over a WriteSessionSink. The session is committed when the stream ends
 * (so every upstream stage has already validated) and aborted if the stream is destroyed or fails.
 */
export interface WriteSessionStage extends Writable {
  /** Result of completeWrite; valid once the stage has finished. */
  result(): UploadResult;
}
export function writeSessionSink(sink: WriteSessionSink): WriteSessionStage {
  let result: UploadResult | undefined;
  const stage = new Writable({
    write(chunk, _enc, cb) {
      sink.write(asBuffer(chunk)).then(() => cb(), cb);
    },
    final(cb) {
      sink.commit().then((r) => {
        result = r;
        cb();
      }, cb);
    },
    destroy(error, cb) {
      if (error) sink.abort().then(() => cb(error), () => cb(error));
      else cb(null);
    },
  }) as WriteSessionStage;
  stage.result = () => {
    if (!result) throw new Error('Write session has not been committed');
    return result;
  };
  return stage;
}

export type IngestStage = Transform | Writable;

/** Runs `source` through `stages` (the last one terminal) with error and backpressure propagation. */
export function runPipeline(source: Readable, ...stages: [IngestStage, ...IngestStage[]]): Promise<void> {
  return pipeline(source, ...(stages as [IngestStage, ...IngestStage[]])) as Promise<void>;
}

export interface IngestResult {
  size: number;
  /** What file-type recognised in the bytes; undefined for formats without magic bytes. */
  detectedMime: string | undefined;
  /** The MIME to store (see resolveUploadMime). */
  mime: string;
  sha256: string;
  upload: UploadResult;
}

/**
 * Standard upload composition: byteCounter -> sniffHead -> sha256Stage -> writeSessionSink.
 * `allowedMimeTypes: null` skips the content sniff (system artifacts, whose MIME product code chose).
 * On any failure the session is aborted, so no object remains; the caller creates the row only on success.
 */
export async function ingestToWriteSession(
  source: Readable,
  provider: StorageProviderInterface,
  path: string,
  options: {
    maxFileSize: number;
    declaredMime: string;
    allowedMimeTypes: string[] | null;
    metadata?: Record<string, string>;
    partSize?: number;
  }
): Promise<IngestResult> {
  const counter = byteCounter(options.maxFileSize);
  const hasher = sha256Stage();
  const sniff = options.allowedMimeTypes === null
    ? null
    : sniffHead((detected, info) => resolveUploadMime(options.declaredMime, detected, options.allowedMimeTypes, info).mime);

  // The session opens lazily, so the object is stored with the sniffed MIME.
  const sink = openWriteSessionSink(
    provider,
    path,
    () => ({ mimeType: sniff?.resolvedMime ?? options.declaredMime, metadata: options.metadata }),
    options.partSize
  );
  const writer = writeSessionSink(sink);
  try {
    const stages: IngestStage[] = [counter, ...(sniff ? [sniff] : []), hasher, writer];
    await runPipeline(source, ...(stages as [IngestStage, ...IngestStage[]]));
  } catch (error) {
    await sink.abort();
    throw error;
  }
  return {
    size: counter.bytes,
    detectedMime: sniff?.detectedMime,
    mime: sniff?.resolvedMime ?? options.declaredMime,
    sha256: hasher.digest(),
    upload: writer.result(),
  };
}
