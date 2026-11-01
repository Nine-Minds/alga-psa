import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { StorageProviderInterface } from '../../storage/src/providers/StorageProvider';
import { isCoManagedUuid } from './sharedWorkIdentity';
import type { CoManagedPortableWorkspaceManifest } from './portableWorkspaceManifest';
import type { PortableStagedBlob } from './portableBlobStaging';
import type { PreparedPortableWorkspaceRecords } from './portableWorkspaceRestoreRecords';
import { assertPortableTransferActive, awaitPortableTransfer, portableTransferSignal } from './portableTransfer';

type NativeRow = Record<string, unknown>;
interface Transfer extends PortableStagedBlob { fileId: string; name: string; mimeType: string }
const fail = (): never => { throw new Error('Invalid portable restore file preparation'); };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Staged-bytes cap: the most blob bytes one restore attempt may place on the storage provider before the
 * database commit. Staged objects exist only between upload and promotion (the upload journal expires an
 * attempt after 35 minutes and the sweeper deletes it), so this bounds what an abandoned or crashed
 * attempt can leave behind. 16 GiB covers realistic MSP workspaces while keeping one attempt well inside
 * the 30-minute transfer window; the operator can lower it, or raise it up to the archive's own limit,
 * with --max-staged-bytes. It is checked against the manifest before any provider write and enforced
 * again while streaming.
 */
export const PORTABLE_RESTORE_DEFAULT_STAGED_BYTES_CAP = 16 * 1024 ** 3;

/**
 * Restore-side file binding for one blob kind (the part of a blob id before the colon). A contributor that
 * exports blobs joins restore by registering a binder; it names the file and rewrites the owning rows so they
 * reference the destination file id. With no binder for a kind, restore fails closed instead of guessing.
 */
export interface PortableRestoreBlobBinder {
  kind: string;
  bind(input: { blobId: string; sha256: string; size: number; destinationFileId: string; records: PreparedPortableWorkspaceRecords['records'];
    mapped(value: unknown, table: string, column: string): string | number; importedByUserId: string }): { name: string; mimeType: string };
}

/** Pure binding adapter for an authenticated archive and a trusted record transformation.
 * No provider, database or source trust is recreated; transport happens separately before DB insertion. */
export function prepareCoManagedPortableWorkspaceFiles(input: {
  manifest: CoManagedPortableWorkspaceManifest; files: readonly PortableStagedBlob[]; preparedRecords: PreparedPortableWorkspaceRecords;
  importedByUserId: string; binders?: readonly PortableRestoreBlobBinder[]; maxStagedBytes?: number;
}, options: { allocateUuid?: () => string; reservedUuids?: readonly string[] } = {}) {
  const manifest = input.manifest, prepared = input.preparedRecords;
  const cap = input.maxStagedBytes ?? PORTABLE_RESTORE_DEFAULT_STAGED_BYTES_CAP;
  if (!Number.isSafeInteger(cap) || cap < 0) fail();
  if (!same(prepared.sourceTenant, manifest.context.sourceTenant) || !isCoManagedUuid(prepared.destinationTenant) ||
      same(prepared.sourceTenant, prepared.destinationTenant) || !isCoManagedUuid(input.importedByUserId) ||
      !prepared.records.users.some(row => same(row.user_id, input.importedByUserId))) fail();
  const total = manifest.blobs.reduce((sum, blob) => sum + blob.size, 0);
  if (total > cap) throw new Error(`Portable restore blobs (${total} bytes) exceed the staged-bytes cap (${cap} bytes)`);
  const binders = new Map((input.binders ?? []).map(binder => [binder.kind, binder]));
  const reserved = new Set<string>([prepared.sourceTenant, prepared.destinationTenant, input.importedByUserId].map(id => id.toLowerCase()));
  for (const domain of prepared.domains) for (const row of domain.mappings) for (const value of [row.source, row.destination]) {
    if (isCoManagedUuid(value)) reserved.add(value.toLowerCase());
  }
  for (const value of options.reservedUuids ?? []) { if (!isCoManagedUuid(value)) fail(); reserved.add(value.toLowerCase()); }
  for (const blob of manifest.blobs) reserved.add(blob.id.split(':')[1].toLowerCase());
  const allocatedIds: string[] = [];
  const allocate = () => {
    const id = (options.allocateUuid ?? randomUUID)();
    if (!isCoManagedUuid(id) || reserved.has(id.toLowerCase())) fail();
    reserved.add(id.toLowerCase()); allocatedIds.push(id.toLowerCase()); return id.toLowerCase();
  };
  const maps = new Map(prepared.domains.map(domain => [JSON.stringify([domain.table, domain.column]),
    new Map(domain.mappings.map(row => [String(row.source).toLowerCase(), row.destination]))]));
  const mapped = (value: unknown, table: string, column: string) => {
    const destination = maps.get(JSON.stringify([table, column]))?.get(String(value).toLowerCase());
    return destination ?? fail();
  };
  const sources = new Map(input.files.map(file => [file.id.toLowerCase(), file]));
  const externalFiles: NativeRow[] = [], transfers: Transfer[] = [];
  for (const descriptor of manifest.blobs) {
    const key = descriptor.id.toLowerCase(), source = sources.get(key);
    const binder = binders.get(descriptor.id.split(':')[0]);
    if (!binder) throw new Error(`Portable restore has no file binder for blob kind "${descriptor.id.split(':')[0]}"`);
    if (!source || typeof source.path !== 'string' || !source.path || source.path.includes('\0') || source.size !== descriptor.size || source.sha256 !== descriptor.sha256) fail();
    const fileId = allocate();
    const name = binder.bind({ blobId: descriptor.id, sha256: descriptor.sha256, size: descriptor.size, destinationFileId: fileId,
      records: prepared.records, mapped, importedByUserId: input.importedByUserId });
    externalFiles.push({ tenant: prepared.destinationTenant, file_id: fileId, original_name: name.name, mime_type: name.mimeType,
      file_size: descriptor.size, uploaded_by_id: input.importedByUserId, is_deleted: false, deleted_at: null, deleted_by_id: null,
      metadata: { portable_restore: { version: 2, package_id: manifest.context.packageId, source_blob_id: descriptor.id, sha256: descriptor.sha256 } } });
    transfers.push({ ...descriptor, path: source!.path, fileId, ...name });
  }
  return { ...prepared, externalFiles, transfers, allocatedIds, maxStagedBytes: cap };
}

export type PreparedCoManagedPortableWorkspaceFiles = ReturnType<typeof prepareCoManagedPortableWorkspaceFiles>;

async function regularSource(path: string, expectedSize: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size !== expectedSize) fail(); return handle; }
  catch (error) { await handle.close(); throw error; }
}
async function verifySource(file: Transfer) {
  const handle = await regularSource(file.path, file.size);
  try {
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      assertPortableTransferActive();
      size += chunk.length; if (size > file.size) fail(); hash.update(chunk);
    }
    if (size !== file.size || hash.digest('hex') !== file.sha256) fail();
  } finally { await handle.close(); }
}

/** Upload lease over the existing provider interface, without StorageService's
 * immediate external_files commit or workflow dispatch. Call only after
 * destination admission. Await all uploads before the destination transaction;
 * dispose on rollback and release only after a successful DB commit. The lease
 * owns only fresh attempt-specific keys, never existing destination objects. */
export async function stageCoManagedPortableWorkspaceFiles(preparedInput: PreparedCoManagedPortableWorkspaceFiles,
  provider: Pick<StorageProviderInterface, 'upload' | 'delete' | 'getCapabilities'>, options: { attemptId?: string } = {}) {
  const prepared = preparedInput;
  const attempt = options.attemptId ?? randomUUID();
  if (!isCoManagedUuid(attempt) || attempt !== attempt.toLowerCase()) fail();
  if (!isCoManagedUuid(prepared.destinationTenant) || !isCoManagedUuid(prepared.packageId)) fail();
  if (prepared.transfers.reduce((sum, file) => sum + file.size, 0) > prepared.maxStagedBytes) fail();
  const capabilities = provider.getCapabilities();
  const permitsMime = (mime: string) => capabilities.allowedMimeTypes === undefined || capabilities.allowedMimeTypes.some(allowed =>
    allowed === '*/*' || (allowed.endsWith('/*') ? mime.startsWith(allowed.slice(0, -1)) : allowed === mime));
  if (!capabilities.supportsStreaming || prepared.transfers.some(file =>
      (capabilities.maxFileSize !== undefined && file.size > capabilities.maxFileSize) || !permitsMime(file.mimeType))) throw new Error('Portable restore files exceed storage capabilities');
  // Recheck all opened-archive local sources before making any provider write.
  for (const transfer of prepared.transfers) await verifySource(transfer);
  const paths = new Set<string>(), externalFiles: NativeRow[] = [];
  const metadataByFile = new Map(prepared.externalFiles.map(file => [file.file_id, file]));
  let released = false;
  const dispose = async () => {
    if (released) return;
    const results = await Promise.allSettled([...paths].map(async path => { await provider.delete(path); paths.delete(path); }));
    if (results.some(result => result.status === 'rejected')) throw new Error('Portable restore upload cleanup failed');
  };
  try {
    for (const transfer of prepared.transfers) {
      assertPortableTransferActive();
      const path = `${prepared.destinationTenant}/portable-restores/${attempt}/${transfer.fileId}`;
      const handle = await regularSource(transfer.path, transfer.size);
      const hash = createHash('sha256'); let size = 0, complete = false;
      const source = handle.createReadStream({ autoClose: false, signal: portableTransferSignal() });
      // A provider may await its own setup before consuming the wrapper. Keep
      // an early source abort handled until its async iterator takes ownership.
      source.on('error', () => {});
      const stream = Readable.from((async function* () {
        for await (const chunk of source) {
          assertPortableTransferActive();
          size += chunk.length; if (size > transfer.size) fail(); hash.update(chunk); yield chunk;
        }
        if (size !== transfer.size || hash.digest('hex') !== transfer.sha256) fail(); complete = true;
      })());
      paths.add(path);
      try {
        const uploaded = await awaitPortableTransfer(() => provider.upload(stream, path, { mime_type: transfer.mimeType,
          size: transfer.size, metadata: { sha256: transfer.sha256 } }),
          async () => { await provider.delete(path); });
        assertPortableTransferActive();
        if (!complete || uploaded.path !== path || uploaded.size !== transfer.size || uploaded.mime_type !== transfer.mimeType) fail();
      } finally { stream.destroy(); source.destroy(); await handle.close(); }
      const row = metadataByFile.get(transfer.fileId) ?? fail();
      externalFiles.push({ ...row, file_name: transfer.fileId, storage_path: path });
    }
    return { externalFiles, dispose, release: () => { released = true; paths.clear(); } };
  } catch (error) { await dispose(); throw error; }
}
