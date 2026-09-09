import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { assertPortableTransferActive, createPortableWriteStream, portableTransferSignal, writePortableBytes } from './portableTransfer';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { createPortableTemporaryDirectory } from './portableTemporaryDirectory';
import { isAbsolute, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PortableStagedBlob } from './portableBlobStaging';

const MAGIC = Buffer.from('ALGA-WORKSPACE-ARCHIVE\0\x01', 'binary');
const HEADER_BYTES = MAGIC.length + 16 + 8;
const FRAME_BYTES = 4 * 1024 * 1024;
const MAX_METADATA = 64 * 1024 * 1024;
const MAX_BLOB = 64 * 1024 ** 3;
const MAX_CONTAINER = 1024 ** 4;
const MAX_FRAMES = Math.ceil(MAX_CONTAINER / FRAME_BYTES) + 1;
const MAX_ARCHIVE = HEADER_BYTES + MAX_CONTAINER + MAX_FRAMES * 21;
const FORMAT = 'alga-workspace-archive';
export const PORTABLE_ARCHIVE_LIMITS = Object.freeze({ archiveBytes: MAX_ARCHIVE, metadataBytes: MAX_METADATA, blobBytes: MAX_BLOB, totalBytes: MAX_CONTAINER, blobs: 100_000, frameBytes: FRAME_BYTES, metadataDepth: 128 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOB_ID = /^[a-z][a-z_]{0,31}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const MESSAGE = 'Portable archive is invalid or cannot be unlocked.';
export interface PortableArchiveContext { packageId: string; sourceTenant: string }
interface BlobDescriptor { id: string; size: number; sha256: string }
interface ArchiveMetadata { format: typeof FORMAT; version: 1; context: PortableArchiveContext; manifest: Record<string, unknown>; blobs: BlobDescriptor[] }
const invalid: () => never = () => { throw new Error(MESSAGE); };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
function contextCopy(value: PortableArchiveContext): PortableArchiveContext {
  if (!object(value) || !exactKeys(value as unknown as Record<string, unknown>, ['packageId', 'sourceTenant']) ||
      typeof value.packageId !== 'string' || !UUID.test(value.packageId) || typeof value.sourceTenant !== 'string' || !UUID.test(value.sourceTenant)) invalid();
  return { packageId: value.packageId.toLowerCase(), sourceTenant: value.sourceTenant.toLowerCase() };
}
function descriptors(value: unknown): BlobDescriptor[] {
  if (!Array.isArray(value) || value.length > 100_000) invalid();
  const ids = new Set<string>(); let bytes = 0;
  return value.map(row => {
    if (!object(row) || !exactKeys(row, ['id', 'size', 'sha256']) || typeof row.id !== 'string' || !BLOB_ID.test(row.id) ||
        ids.has(row.id.toLowerCase()) || !Number.isSafeInteger(row.size) || Number(row.size) < 0 || Number(row.size) > MAX_BLOB ||
        typeof row.sha256 !== 'string' || !HASH.test(row.sha256)) invalid();
    ids.add(row.id.toLowerCase()); bytes += Number(row.size); if (bytes > MAX_CONTAINER) invalid();
    return { id: row.id, size: Number(row.size), sha256: row.sha256 };
  });
}
/** Preflight exact JSON UTF-8 size before stringify/Buffer allocation. Only
 * data properties are accepted, so serialization cannot execute authored hooks. */
function metadataSize(value: unknown): number {
  let bytes = 0;
  const ancestors = new Set<object>();
  const add = (count: number) => { bytes += count; if (bytes > MAX_METADATA) invalid(); };
  const string = (text: string) => {
    add(2);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
      else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (item: unknown, depth: number) => {
    if (depth > 128) invalid();
    if (item === null) { add(4); return; }
    if (typeof item === 'string') { string(item); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { add(JSON.stringify(item).length); return; }
    if (!Array.isArray(item) && !object(item)) invalid();
    for (let prototype: object | null = item; prototype; prototype = Object.getPrototypeOf(prototype)) {
      const hook = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
      if (hook) { if (!Object.hasOwn(hook, 'value') || typeof hook.value === 'function') invalid(); break; }
    }
    if (ancestors.has(item)) invalid(); ancestors.add(item); add(2);
    const array = Array.isArray(item), keys = array ? null : Object.keys(item);
    const length = array ? item.length : keys!.length;
    if (array && length > MAX_METADATA / 2) invalid();
    for (let index = 0; index < length; index++) {
      if (index) add(1);
      const key = array ? String(index) : keys![index], property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !Object.hasOwn(property, 'value')) invalid();
      if (!Array.isArray(item)) { string(key); add(1); }
      visit(property.value, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return bytes;
}
function boundedMetadata(value: unknown): Buffer {
  const bytes = metadataSize(value);
  const output = Buffer.from(JSON.stringify(value), 'utf8');
  if (output.length !== bytes || output.length > MAX_METADATA) { output.fill(0); invalid(); }
  return output;
}

async function keyFor(passphrase: string, salt: Buffer) {
  if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase, 'utf8') < 16 || Buffer.byteLength(passphrase, 'utf8') > 1024) invalid();
  const password = Buffer.from(passphrase, 'utf8');
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { password.fill(0); }
}
const privateDirectory = () => createPortableTemporaryDirectory('archive');
async function regularFile(path: string, maxBytes: number) {
  if (typeof path !== 'string' || !isAbsolute(path)) invalid();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size > maxBytes) invalid();
    return { file, size: stat.size };
  } catch (error) { await file.close(); throw error; }
}
async function readAt(file: FileHandle, size: number, position: number): Promise<Buffer> {
  const result = Buffer.alloc(size); let offset = 0;
  while (offset < size) { assertPortableTransferActive(); const { bytesRead } = await file.read(result, offset, size - offset, position + offset); if (!bytesRead) invalid(); offset += bytesRead; }
  return result;
}
async function writeAll(file: FileHandle, bytes: Buffer) {
  return writePortableBytes(file, bytes);
}
function frameContext(header: Buffer, index: number, final: boolean, size: number) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_FRAMES || index > 0xffffffff || size > FRAME_BYTES || size < 0 || final !== (size === 0)) invalid();
  const counter = Buffer.alloc(4); counter.writeUInt32BE(index);
  const wire = Buffer.alloc(5); wire[0] = final ? 1 : 0; wire.writeUInt32BE(size, 1);
  return { wire, nonce: Buffer.concat([header.subarray(HEADER_BYTES - 8), counter]), aad: Buffer.concat([header, counter, wire]) };
}
async function* encryptFrames(source: AsyncIterable<Buffer>, key: Buffer, header: Buffer) {
  yield header;
  let buffer = Buffer.alloc(FRAME_BYTES), used = 0, index = 0, total = 0;
  const encode = (bytes: Buffer, final: boolean) => {
    const { wire, nonce, aad } = frameContext(header, index++, final, bytes.length);
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad);
    return Buffer.concat([wire, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  };
  try {
    for await (const chunk of source) {
      total += chunk.length; if (total > MAX_CONTAINER) invalid();
      for (let offset = 0; offset < chunk.length;) {
        const count = Math.min(FRAME_BYTES - used, chunk.length - offset);
        chunk.copy(buffer, used, offset, offset + count); used += count; offset += count;
        if (used === FRAME_BYTES) { yield encode(buffer, false); buffer.fill(0); used = 0; }
      }
    }
    if (used) yield encode(buffer.subarray(0, used), false);
    yield encode(Buffer.alloc(0), true);
  } finally { buffer.fill(0); }
}

/** Internal transport only. Inputs must already be authorized and staged by
 * collectors. The customer passphrase is never a job/provider argument. The
 * encrypted container authenticates context, manifest, ordered blob membership
 * and every byte together; it is not an export authorization boundary. */
export async function sealPortableArchive(input: { context: PortableArchiveContext; manifest: Record<string, unknown>; files: readonly PortableStagedBlob[] }, passphrase: string) {
  let key: Buffer | undefined, metadata: Buffer | undefined, lease: Awaited<ReturnType<typeof privateDirectory>> | undefined;
  try {
    assertPortableTransferActive();
    const context = contextCopy(input.context);
    if (!object(input.manifest) || !Array.isArray(input.files) || input.files.length > 100_000) invalid();
    const files = input.files.map(row => ({ id: row.id, path: row.path, size: row.size, sha256: row.sha256 }));
    const blobs = descriptors(files.map(({ id, size, sha256 }) => ({ id, size, sha256 })));
    metadata = boundedMetadata({ format: FORMAT, version: 1, context, manifest: input.manifest, blobs });
    if (metadata.length > MAX_METADATA || metadata.length + 4 + blobs.reduce((sum, row) => sum + row.size, 0) > MAX_CONTAINER) invalid();
    const salt = randomBytes(16), header = Buffer.concat([MAGIC, salt, randomBytes(8)]);
    key = await keyFor(passphrase, salt); lease = await privateDirectory();
    const metadataSnapshot = metadata;
    async function* plaintext() {
      const size = Buffer.alloc(4); size.writeUInt32BE(metadataSnapshot.length); yield size; yield metadataSnapshot;
      for (const blob of files) {
        const source = await regularFile(blob.path, MAX_BLOB);
        try {
          if (source.size !== blob.size) invalid();
          const hash = createHash('sha256'); let seen = 0;
          for await (const chunk of source.file.createReadStream({ autoClose: false })) {
            const bytes = chunk as Buffer; seen += bytes.length; if (seen > blob.size) invalid(); hash.update(bytes); yield bytes;
          }
          if (seen !== blob.size || hash.digest('hex') !== blob.sha256) invalid();
        } finally { await source.file.close(); }
      }
    }
    const partial = join(lease.directory, 'archive.partial'), path = join(lease.directory, 'workspace.alga');
    let size = 0; const hash = createHash('sha256');
    await pipeline(encryptFrames(plaintext(), key, header), new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length; if (size > MAX_ARCHIVE) return callback(new Error(MESSAGE)); hash.update(chunk); callback(null, chunk);
    } }), createPortableWriteStream(partial), { signal: portableTransferSignal() });
    await rename(partial, path);
    lease.assertActive();
    return { context, path, size, sha256: hash.digest('hex'), dispose: lease.dispose, assertActive: lease.assertActive };
  } catch { if (lease) await lease.dispose().catch(() => {}); return invalid(); }
  finally { key?.fill(0); metadata?.fill(0); }
}

/** All frames and the final marker are authenticated in private quarantine
 * before metadata is parsed or any usable lease is returned. The caller must
 * validate its manifest schema/graph before performing destination operations. */
export async function openPortableArchive(path: string, passphrase: string, expectedContext?: PortableArchiveContext) {
  let key: Buffer | undefined, source: Awaited<ReturnType<typeof regularFile>> | undefined;
  let quarantine: FileHandle | undefined, lease: Awaited<ReturnType<typeof privateDirectory>> | undefined;
  try {
    const expected = expectedContext ? contextCopy(expectedContext) : undefined;
    assertPortableTransferActive();
    source = await regularFile(path, MAX_ARCHIVE);
    if (source.size < HEADER_BYTES + 21) invalid();
    const header = await readAt(source.file, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) invalid();
    key = await keyFor(passphrase, header.subarray(MAGIC.length, MAGIC.length + 16));
    lease = await privateDirectory();
    const quarantinePath = join(lease.directory, 'authenticated-container.partial');
    quarantine = await open(quarantinePath, 'wx+', 0o600);
    let position = HEADER_BYTES, total = 0, index = 0, shortFrame = false, finished = false;
    while (!finished) {
      if (position + 21 > source.size) invalid();
      const wire = await readAt(source.file, 5, position); position += 5;
      const final = wire[0] === 1, length = wire.readUInt32BE(1);
      if (wire[0] > 1 || final !== (length === 0) || length > FRAME_BYTES || shortFrame && !final || position + length + 16 > source.size || total + length > MAX_CONTAINER) invalid();
      const { nonce, aad } = frameContext(header, index++, final, length);
      const ciphertext = await readAt(source.file, length, position); position += length;
      const tag = await readAt(source.file, 16, position); position += 16;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(aad); decipher.setAuthTag(tag);
      let provisional: Buffer | undefined, plaintext: Buffer | undefined;
      try {
        provisional = decipher.update(ciphertext); plaintext = Buffer.concat([provisional, decipher.final()]);
        if (final) { if (position !== source.size) invalid(); finished = true; }
        else { await writeAll(quarantine, plaintext); total += length; shortFrame = length < FRAME_BYTES; }
      } finally { provisional?.fill(0); plaintext?.fill(0); }
    }
    if ((await source.file.stat()).size !== source.size || total < 4) invalid();
    await source.file.close(); source = undefined;
    const metadataLength = (await readAt(quarantine, 4, 0)).readUInt32BE(0);
    if (!metadataLength || metadataLength > MAX_METADATA || metadataLength + 4 > total) invalid();
    const metadataBytes = await readAt(quarantine, metadataLength, 4);
    let metadata: ArchiveMetadata;
    try { metadata = JSON.parse(metadataBytes.toString('utf8')); } finally { metadataBytes.fill(0); }
    if (!object(metadata) || !exactKeys(metadata as unknown as Record<string, unknown>, ['format', 'version', 'context', 'manifest', 'blobs']) || metadata.format !== FORMAT || metadata.version !== 1 || !object(metadata.manifest)) invalid();
    metadataSize(metadata);
    const context = contextCopy(metadata.context), blobs = descriptors(metadata.blobs);
    if (expected && (context.packageId !== expected.packageId || context.sourceTenant !== expected.sourceTenant)) invalid();
    if (metadataLength + 4 + blobs.reduce((sum, row) => sum + row.size, 0) !== total) invalid();
    const files: PortableStagedBlob[] = []; let offset = metadataLength + 4;
    for (const blob of blobs) {
      const filePath = join(lease.directory, randomUUID()), hash = createHash('sha256'); let seen = 0;
      const output = createPortableWriteStream(filePath);
      if (blob.size) {
        await pipeline(quarantine.createReadStream({ start: offset, end: offset + blob.size - 1, autoClose: false }), new Transform({ transform(chunk, _encoding, callback) {
          seen += chunk.length; if (seen > blob.size) return callback(new Error(MESSAGE)); hash.update(chunk); callback(null, chunk);
        } }), output, { signal: portableTransferSignal() });
      } else { await pipeline((async function* () {})(), output, { signal: portableTransferSignal() }); }
      if (seen !== blob.size || hash.digest('hex') !== blob.sha256) invalid();
      files.push({ ...blob, path: filePath }); offset += blob.size;
    }
    await quarantine.close(); quarantine = undefined; await rm(quarantinePath);
    return { context, manifest: metadata.manifest, files, dispose: lease.dispose };
  } catch { await quarantine?.close().catch(() => {}); await source?.file.close().catch(() => {}); if (lease) await lease.dispose().catch(() => {}); return invalid(); }
  finally { key?.fill(0); }
}
