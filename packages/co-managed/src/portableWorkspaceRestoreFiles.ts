import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { StorageProviderInterface } from '../../storage/src/providers/StorageProvider';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { validateCoManagedPortableWorkspaceManifest } from './portableWorkspaceManifest';
import type { PortableStagedBlob } from './portableBlobStaging';
import type { prepareCoManagedPortableWorkspaceRecords } from './portableWorkspaceRestoreRecords';
import { CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS } from './portableDocumentCatalog';

type PreparedRecords = ReturnType<typeof prepareCoManagedPortableWorkspaceRecords>;
type NativeRow = Record<string, unknown>;
interface Transfer extends PortableStagedBlob { fileId: string; name: string; mimeType: string }
interface ExternalFileMetadata extends NativeRow {
  tenant: string; file_id: string; original_name: string; mime_type: string; file_size: number; uploaded_by_id: string;
}
const fail = (): never => { throw new Error('Invalid portable restore file preparation'); };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Pure binding adapter for an authenticated archive and a trusted record
 * transformation. No provider, database, source trust or authored JSON rewrite.
 * The historical uploader must be selected by admission from the inactive
 * imported users, never from a foreign installer principal. Native file transport happens separately before DB insertion. */
export function prepareCoManagedPortableWorkspaceFiles(input: {
  manifest: unknown; files: readonly PortableStagedBlob[]; preparedRecords: PreparedRecords; importedByUserId: string;
}, options: { allocateUuid?: () => string; reservedUuids?: readonly string[] } = {}) {
  const request = structuredClone(input);
  const manifest = validateCoManagedPortableWorkspaceManifest(request.manifest, undefined, request.files);
  const prepared = request.preparedRecords;
  if (!same(prepared.sourceTenant, manifest.context.sourceTenant) || !isCoManagedUuid(prepared.destinationTenant) ||
      same(prepared.sourceTenant, prepared.destinationTenant) || !isCoManagedUuid(request.importedByUserId) ||
      !prepared.records.users.some(row => same(row.user_id, request.importedByUserId))) fail();
  const allocatedIds: string[] = [], reserved = new Set<string>([prepared.sourceTenant, prepared.destinationTenant, request.importedByUserId].map(id => id.toLowerCase()));
  for (const domain of prepared.domains) for (const row of domain.mappings) for (const value of [row.source, row.destination]) {
    if (isCoManagedUuid(value)) reserved.add(value.toLowerCase());
  }
  for (const value of options.reservedUuids ?? []) { if (!isCoManagedUuid(value)) fail(); reserved.add(value.toLowerCase()); }
  for (const blob of manifest.blobs) reserved.add(blob.id.split(':')[1].toLowerCase());
  const allocate = () => {
    const id = (options.allocateUuid ?? randomUUID)();
    if (!isCoManagedUuid(id) || reserved.has(id.toLowerCase())) fail();
    reserved.add(id.toLowerCase()); allocatedIds.push(id.toLowerCase()); return id.toLowerCase();
  };
  const domains = new Map(prepared.domains.map(domain => [JSON.stringify([domain.table, domain.column]),
    new Map(domain.mappings.map(row => [String(row.source).toLowerCase(), row.destination]))]));
  const mapped = (table: string, column: string, source: unknown) => {
    if (!isCoManagedUuid(source)) return fail();
    const value = domains.get(JSON.stringify([table, column]))?.get(source.toLowerCase());
    if (!isCoManagedUuid(value)) return fail(); return value;
  };
  const records = prepared.records;
  const indexes = new Map<string, Map<string, NativeRow>>();
  const destination = (table: string, column: string, source: unknown) => {
    if (!indexes.has(table)) indexes.set(table, new Map(records[table].map(row => [String(row[column]).toLowerCase(), row])));
    return indexes.get(table)!.get(mapped(table, column, source).toLowerCase()) ?? fail();
  };
  const names = new Map<string, { name: string; mimeType: string }>();
  for (const group of [manifest.sections.documents, manifest.supplementalFiles, manifest.remoteMeetingFiles]) {
    for (const blob of group.blobs) names.set(blob.id.toLowerCase(), { name: blob.name, mimeType: blob.mimeType });
  }
  for (const attachment of manifest.conversationFiles.attachments) names.set(attachment.blobId.toLowerCase(), { name: attachment.fileName, mimeType: attachment.mimeType });
  const sources = new Map(request.files.map(file => [file.id.toLowerCase(), file]));
  const externalFiles: ExternalFileMetadata[] = [], transfers: Transfer[] = [], fileIds = new Map<string, string>();
  for (const descriptor of manifest.blobs) {
    const key = descriptor.id.toLowerCase(), fileId = allocate(), source = sources.get(key)!, name = names.get(key)!;
    if (typeof source.path !== 'string' || !source.path || source.path.includes('\0')) fail();
    fileIds.set(key, fileId);
    externalFiles.push({ tenant: prepared.destinationTenant, file_id: fileId, original_name: name.name, mime_type: name.mimeType,
      file_size: descriptor.size, uploaded_by_id: request.importedByUserId, is_deleted: false, deleted_at: null, deleted_by_id: null,
      metadata: { portable_restore: { version: 1, package_id: manifest.context.packageId, source_blob_id: descriptor.id, sha256: descriptor.sha256 } } });
    transfers.push({ ...descriptor, path: source.path, fileId, ...name });
  }
  const fileId = (blobId: string) => fileIds.get(blobId.toLowerCase()) ?? fail();
  for (const binding of manifest.sections.documents.fileBindings) {
    destination('documents', 'document_id', binding.documentId)[binding.field] = fileId(binding.blobId);
  }
  for (const group of [manifest.supplementalFiles, manifest.remoteMeetingFiles]) for (const binding of group.fileBindings) {
    destination('online_meeting_artifacts', 'artifact_id', binding.recordId).file_id = fileId(binding.blobId);
  }
  // Existing native document order numbers survive; new attachment documents
  // receive distinct native integer values without relying on a source sequence.
  let order = records.documents.reduce((max, row) => Math.max(max, Number(row.order_number) || 0), 0);
  const filesById = new Map(externalFiles.map(file => [file.file_id, file]));
  for (const attachment of manifest.conversationFiles.attachments) {
    const ticketId = mapped('tickets', 'ticket_id', attachment.ticketId), threadId = mapped('comment_threads', 'thread_id', attachment.threadId),
      commentId = mapped('comments', 'comment_id', attachment.commentId);
    const localUser = same(attachment.actorTenant, prepared.sourceTenant)
      ? domains.get(JSON.stringify(['users', 'user_id']))?.get(attachment.actorUserId.toLowerCase()) : undefined;
    const actorTenant = localUser ? prepared.destinationTenant : attachment.actorTenant, actorUserId = localUser ?? attachment.actorUserId;
    const documentId = allocate(), ownerId = localUser ?? request.importedByUserId;
    if (!Number.isSafeInteger(++order) || order > 2_147_483_647) fail();
    const document = Object.fromEntries(CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS.documents.map(column => [column, null]));
    Object.assign(document, { document_id: documentId, document_name: attachment.fileName, user_id: ownerId, created_by: ownerId,
      order_number: order, entered_at: attachment.createdAt, updated_at: attachment.createdAt,
      file_id: fileId(attachment.blobId), mime_type: attachment.mimeType, file_size: attachment.size,
      is_client_visible: attachment.audience === 'requester' });
    records.documents.push(document);
    records.document_associations.push({ association_id: allocate(), document_id: documentId, entity_id: ticketId,
      entity_type: 'ticket', created_at: attachment.createdAt, is_entity_logo: false, entity_logo_variant: 'default' });
    const file = filesById.get(fileId(attachment.blobId))!;
    file.metadata = { ...(file.metadata as NativeRow), conversation: { ticket_id: ticketId, thread_id: threadId, comment_id: commentId,
      document_id: documentId, audience: attachment.audience, created_at: attachment.createdAt, actor_tenant: actorTenant, actor_user_id: actorUserId,
      actor_reference_id: attachment.actorReferenceId === null ? null : mapped('collaboration_actor_references', 'actor_reference_id', attachment.actorReferenceId),
      actor_display_name: attachment.actorDisplayName, actor_organization_name: attachment.actorOrganizationName } };
  }
  // Reconnect sections explicitly: structuredClone preserves aliases today,
  // but callers need not have retained the original records/sections aliases.
  for (const section of Object.values(prepared.sections)) for (const table of Object.keys(section)) section[table] = records[table];
  return { ...prepared, packageId: manifest.context.packageId, externalFiles, transfers, allocatedIds };
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
  provider: Pick<StorageProviderInterface, 'upload' | 'delete' | 'getCapabilities'>) {
  const prepared = structuredClone(preparedInput);
  if (!isCoManagedUuid(prepared.destinationTenant) || !isCoManagedUuid(prepared.packageId)) fail();
  const capabilities = provider.getCapabilities();
  if (!capabilities.supportsStreaming || prepared.transfers.some(file => file.size > capabilities.maxFileSize ||
      capabilities.allowedMimeTypes?.length && !capabilities.allowedMimeTypes.includes(file.mimeType))) throw new Error('Portable restore files exceed storage capabilities');
  // Recheck all opened-archive local sources before making any provider write.
  for (const transfer of prepared.transfers) await verifySource(transfer);
  const attempt = randomUUID(), paths = new Set<string>(), externalFiles: NativeRow[] = [];
  const metadataByFile = new Map(prepared.externalFiles.map(file => [file.file_id, file]));
  let released = false;
  const dispose = async () => {
    if (released) return;
    const results = await Promise.allSettled([...paths].map(async path => { await provider.delete(path); paths.delete(path); }));
    if (results.some(result => result.status === 'rejected')) throw new Error('Portable restore upload cleanup failed');
  };
  try {
    for (const transfer of prepared.transfers) {
      const path = `${prepared.destinationTenant}/portable-restores/${attempt}/${transfer.fileId}`;
      const handle = await regularSource(transfer.path, transfer.size);
      const hash = createHash('sha256'); let size = 0, complete = false;
      const source = handle.createReadStream({ autoClose: false });
      const stream = Readable.from((async function* () {
        for await (const chunk of source) {
          size += chunk.length; if (size > transfer.size) fail(); hash.update(chunk); yield chunk;
        }
        if (size !== transfer.size || hash.digest('hex') !== transfer.sha256) fail(); complete = true;
      })());
      paths.add(path);
      try {
        const uploaded = await provider.upload(stream, path, { mime_type: transfer.mimeType, metadata: { sha256: transfer.sha256 } });
        if (!complete || uploaded.path !== path || uploaded.size !== transfer.size || uploaded.mime_type !== transfer.mimeType) fail();
      } finally { stream.destroy(); source.destroy(); await handle.close(); }
      const row = metadataByFile.get(transfer.fileId) ?? fail();
      externalFiles.push({ ...row, file_name: transfer.fileId, storage_path: path });
    }
    return { externalFiles, dispose, release: () => { released = true; paths.clear(); } };
  } catch (error) { await dispose(); throw error; }
}
