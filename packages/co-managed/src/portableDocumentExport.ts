import { validatePortableRecordSection } from './portableRecordValidation';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { stageCoManagedPortableBlobs } from './portableBlobStaging';
import { resolveDocumentAuthorizationRecords } from '@alga-psa/shared/lib/documents/authorizationRecords';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { admitCoManagedMeetingDocuments } from './nativeMeetingRead';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS as COLUMNS, type CoManagedPortableDocumentRecords,
  type CoManagedPortableDocumentTable } from './portableDocumentCatalog';

const REFERENCES = [
  ['documents', 'type_id', 'document_types', 'type_id'], ['documents', 'shared_type_id', 'shared_document_types', 'type_id'],
  ['document_versions', 'document_id', 'documents', 'document_id'], ['document_content', 'document_id', 'documents', 'document_id'],
  ['document_block_content', 'document_id', 'documents', 'document_id'], ['document_block_content', 'version_id', 'document_versions', 'version_id'],
  ['document_associations', 'document_id', 'documents', 'document_id'], ['document_folders', 'parent_folder_id', 'document_folders', 'folder_id'],
  ['kb_articles', 'document_id', 'documents', 'document_id'], ['kb_article_relations', 'source_article_id', 'kb_articles', 'article_id'],
  ['kb_article_relations', 'target_article_id', 'kb_articles', 'article_id'], ['kb_article_reviewers', 'article_id', 'kb_articles', 'article_id'],
] as const;

function validateRecords(records: CoManagedPortableDocumentRecords) {
  validatePortableRecordSection(records, { columns: COLUMNS, references: REFERENCES });
}

function sourcePath(tenant: string, input: unknown): string {
  if (typeof input !== 'string' || /[\\\x00-\x1f]/.test(input)) throw new CoManagedSharedWorkError();
  const parts = input.replace(/^\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new CoManagedSharedWorkError();
  // Current native uploads and generated PDF uploads use these two layouts.
  if (!((parts[0] === tenant && parts.length >= 2) || (parts[0] === 'pdfs' && parts[1] === tenant && parts.length >= 3))) throw new CoManagedSharedWorkError();
  return input;
}

interface SourceBlob { id: string; path: string; size: number; name: string; mimeType: string }
interface FileBinding { documentId: string; field: 'file_id' | 'thumbnail_file_id' | 'preview_file_id'; blobId: string }

async function collect(db: Knex, actor: CoManagedSessionActor) {
  return db.transaction(trx => withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    for (const resource of ['document', 'system_settings']) {
      if (!await hasCoManagedLocalPermission(current, verified, resource, 'read', true)) throw new CoManagedSharedWorkError();
    }
    const settings = await authorizeCoManagedLocalRecord(current, actor, subject, 'system_settings', 'read', { id: actor.tenant });
    if (settings.redactedFields.length) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, actor.tenant), records = {} as CoManagedPortableDocumentRecords;
    for (const table of Object.keys(COLUMNS) as CoManagedPortableDocumentTable[]) {
      const query = table === 'shared_document_types' ? current(table) : own.table(table);
      records[table] = await query.select(...COLUMNS[table]).orderBy(COLUMNS[table][0]).limit(100_001).forShare();
    }
    const user = await own.table('users').where('user_id', actor.userId).first('user_id', 'user_type', 'contact_id');
    const documents = records.documents.map(row => ({ document_id: String(row.document_id), created_by: row.created_by as string | null,
      is_client_visible: row.is_client_visible as boolean }));
    const authorization = await resolveDocumentAuthorizationRecords(current, actor.tenant, user as IUser, documents, { lock: true });
    for (const document of documents) {
      const record = authorization.get(document.document_id);
      if (!record) throw new CoManagedSharedWorkError();
      const decision = await authorizeCoManagedLocalRecord(current, actor, subject, 'document', 'read', record);
      if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
    }
    const meetings = await admitCoManagedMeetingDocuments(current, actor.tenant, documents.map(row => row.document_id), async () => actor);
    if (meetings.handled && meetings.deniedDocumentIds.length) throw new CoManagedSharedWorkError();
    validateRecords(records);
    const fileIds = new Set<string>();
    for (const row of records.documents) for (const column of ['file_id', 'thumbnail_file_id', 'preview_file_id']) {
      if (row[column] !== null) {
        if (!isCoManagedUuid(row[column])) throw new Error('Invalid portable document file identity');
        fileIds.add(row[column]);
      }
    }
    const files = new Map<string, any>();
    const ids = [...fileIds].sort();
    for (let offset = 0; offset < ids.length; offset += 1000) {
      for (const file of await own.table('external_files').whereIn('file_id', ids.slice(offset, offset + 1000)).orderBy('file_id').forShare()
        .select('file_id', 'storage_path', 'file_size', 'original_name', 'mime_type', 'is_deleted', 'created_at', 'updated_at')) files.set(file.file_id, file);
    }
    const legacyPaths = await own.table('documents').whereNull('file_id').whereNotNull('storage_path').orderBy('document_id').forShare()
      .select('document_id', 'storage_path', 'file_size', 'document_name', 'mime_type');
    const blobs: SourceBlob[] = [], bindings: FileBinding[] = [];
    for (const id of ids) {
      const file = files.get(id), size = Number(file?.file_size);
      if (!file || file.is_deleted || !Number.isSafeInteger(size) || size < 0) throw new Error('Portable document file is unavailable');
      blobs.push({ id: `file:${id}`, path: sourcePath(actor.tenant, file.storage_path), size, name: file.original_name, mimeType: file.mime_type });
    }
    for (const row of records.documents) for (const field of ['file_id', 'thumbnail_file_id', 'preview_file_id'] as const) {
      if (row[field]) bindings.push({ documentId: String(row.document_id), field, blobId: `file:${row[field]}` });
    }
    for (const row of legacyPaths) {
      const size = Number(row.file_size);
      if (row.file_size === null || !Number.isSafeInteger(size) || size < 0) throw new Error('Legacy portable document has no valid size');
      blobs.push({ id: `document:${row.document_id}`, path: sourcePath(actor.tenant, row.storage_path), size, name: row.document_name, mimeType: row.mime_type || 'application/octet-stream' });
      bindings.push({ documentId: row.document_id, field: 'file_id', blobId: `document:${row.document_id}` });
    }
    if (meetings.handled && 'assertCurrent' in meetings) await meetings.assertCurrent?.();
    return { records, blobs, bindings, fileMetadata: [...files.values()], legacyPaths };
  }), { isolationLevel: 'repeatable read' });
}

const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Stages actual bytes privately before rechecking source/authority. The trusted
 * package assembler owns the returned lease and must call dispose in finally;
 * neither temporary paths nor storage paths belong in a browser payload. */
export async function exportCoManagedPortableDocuments(db: Knex, inputActor: CoManagedSessionActor, packageId: string) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  const snapshot = await collect(db, actor), original = checksum(snapshot);
  const staged = await stageCoManagedPortableBlobs(snapshot.blobs);
  try {
    const { files } = staged;
    if (checksum(await collect(db, actor)) !== original) throw new CoManagedSharedWorkError();
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-documents', version: 1, packageId, sourceTenant: actor.tenant,
      records: snapshot.records, references: REFERENCES, fileBindings: snapshot.bindings,
      blobs: snapshot.blobs.map(({ path: _path, ...blob }) => ({ ...blob, sha256: files.find(file => file.id === blob.id)!.sha256 })) }));
    return { component: { ...payload, sha256: checksum(payload) }, files, dispose: staged.dispose };
  } catch (error) { await staged.dispose(); throw error; }
}
