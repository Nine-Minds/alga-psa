import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { coManagedArchiveStorageProvider } from './archiveStorageProvider';
import { assertCoManagedAttachmentPath } from './attachmentStoragePath';
import { coManagedAttachmentParent } from './attachmentParent';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/**
 * Archive files: a copy-on-retain PRIMITIVE. L4b builds the ability to take an owned, hash-verified
 * copy of a conversation file that survives the customer's tenant deletion; L7a decides WHAT is
 * retained and WHEN (departure/closure policy) and runs the mover. Nothing here is registered,
 * scheduled or called from a native or conversation path.
 *
 * Lifecycle: `retainFile` snapshots verified bytes into the sponsor's row inside the caller's
 * transaction (status `pending`) so neither trust closure nor upload cleanup can lose them;
 * `storeCoManagedArchiveFiles` later moves those already-owned bytes to object storage (`ready`).
 * Identity and content columns are immutable by construction: no code path updates them (PLAN §3
 * forbids a trigger; this module is the only writer of the table).
 */
const TABLE = 'co_managed_archive_files';
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function coManagedArchiveFilePath(tenant: string, archiveFileId: string): string {
  if (![tenant, archiveFileId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return `co-management-archive/${tenant}/${archiveFileId}`;
}

export interface RetainFileInput {
  /** The retaining (sponsor) tenant that will own the archive row. */
  tenant: string;
  /** The tenant that holds the conversation attachment (the customer tenant). */
  sourceTenant: string;
  fileId: string;
  /** Expected sha-256 of the bytes; a mismatch refuses the retain. */
  hash: string;
  relationshipId: string;
  clientId: string;
  audience: 'requester' | 'shared_it';
}
export interface ArchiveFileReceipt { archiveFileId: string; status: 'pending' | 'ready'; contentHash: string }

/** Retain one ready, visible conversation file. Idempotent per (sponsor, customer, relationship, file). */
export async function retainFile(trx: Knex.Transaction, input: RetainFileInput, read?: (path: string) => Promise<Uint8Array>): Promise<ArchiveFileReceipt> {
  if (!trx.isTransaction || ![input.tenant, input.sourceTenant, input.fileId, input.relationshipId, input.clientId].every(isCoManagedUuid) ||
      input.tenant === input.sourceTenant || !/^[0-9a-f]{64}$/.test(input.hash) || !['requester', 'shared_it'].includes(input.audience)) throw new CoManagedSharedWorkError();
  const sponsor = tenantDb(trx, input.tenant);
  const key = { customer_tenant: input.sourceTenant, relationship_id: input.relationshipId, source_tenant: input.sourceTenant, attachment_id: input.fileId };
  const retained = await sponsor.table(TABLE).where(key).forUpdate().first('archive_file_id', 'content_hash', 'status');
  if (retained) {
    if (retained.content_hash !== input.hash) throw new Error('Retained archive file identity was reused');
    return { archiveFileId: retained.archive_file_id, status: retained.status, contentHash: retained.content_hash };
  }
  const file = await tenantDb(trx, input.sourceTenant).table('co_management_conversation_attachments')
    .where({ attachment_id: input.fileId, relationship_id: input.relationshipId, status: 'ready' }).whereNull('discarded_at').whereNull('purged_at').forShare().first();
  if (!file || file.content_hash !== input.hash) throw new CoManagedSharedWorkError();
  const path = assertCoManagedAttachmentPath(file);
  const bytes = Buffer.from(await (read ?? (async p => (await coManagedArchiveStorageProvider()).download(p)))(path));
  if (bytes.length !== file.file_size || checksum(bytes) !== file.content_hash) throw new Error('Archive source attachment failed integrity verification');
  const archiveFileId = randomUUID();
  // write-admission: exempt — co-managed archive file ledger, written by the retainFile primitive
  await sponsor.table(TABLE).insert({ tenant: input.tenant, archive_file_id: archiveFileId, ...key, client_id: input.clientId,
    ...coManagedAttachmentParent({ kind: file.project_task_id ? 'project_task' : 'ticket', id: file.project_task_id ?? file.ticket_id }),
    thread_id: file.thread_id, comment_id: file.comment_id, audience: input.audience, file_name: file.file_name, mime_type: file.mime_type,
    file_size: file.file_size, content_hash: file.content_hash, staged_bytes: bytes, captured_at: trx.raw('clock_timestamp()') });
  return { archiveFileId, status: 'pending', contentHash: file.content_hash };
}

/** Read a retained file (staged bytes until stored, then object storage), always re-verifying the hash. */
export async function readArchivedFile(db: Knex, tenant: string, archiveFileId: string, read?: (path: string) => Promise<Uint8Array>) {
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(archiveFileId)) throw new CoManagedSharedWorkError();
  const row = await tenantDb(db, tenant).table(TABLE).where({ archive_file_id: archiveFileId }).first();
  if (!row) throw new CoManagedSharedWorkError();
  const content = row.status === 'ready'
    ? Buffer.from(await (read ?? (async p => (await coManagedArchiveStorageProvider()).download(p)))(coManagedArchiveFilePath(tenant, archiveFileId)))
    : row.staged_bytes as Buffer;
  if (!content || content.length !== row.file_size || checksum(content) !== row.content_hash) throw new Error('Archive file failed integrity verification');
  return { fileName: row.file_name as string, mimeType: row.mime_type as string, size: row.file_size as number, contentHash: row.content_hash as string, content };
}

/** Tenant maintenance consumes only owner-held immutable staging. A lost provider acknowledgement
 * retries the same owner-qualified object; ready rows never change. Pending bytes are retained until
 * complete object storage is confirmed. Not scheduled by L4b (L7a). */
export async function storeCoManagedArchiveFiles(db: Knex, tenant: string, limit = 100) {
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid archive file maintenance');
  const result = { stored: 0, failed: 0 };
  const due = await tenantDb(db, tenant).table(TABLE).where('status', 'pending').where('next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .orderBy('next_attempt_at').orderBy('archive_file_id').limit(limit).select('archive_file_id');
  for (const candidate of due) {
    try {
      const stored = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant), row = await owner.table(TABLE).where({ archive_file_id: candidate.archive_file_id, status: 'pending' })
          .where('next_attempt_at', '<=', trx.raw('clock_timestamp()')).forUpdate().skipLocked().first();
        if (!row) return false;
        if (!Buffer.isBuffer(row.staged_bytes) || row.staged_bytes.length !== row.file_size || checksum(row.staged_bytes) !== row.content_hash) throw new Error('Archive staging failed integrity verification');
        const path = coManagedArchiveFilePath(tenant, row.archive_file_id), provider = await coManagedArchiveStorageProvider();
        const uploaded = await provider.upload(row.staged_bytes, path, { mime_type: row.mime_type });
        if (uploaded.path !== path || uploaded.size !== row.file_size) throw new Error('Archive storage did not confirm the complete object');
        // write-admission: exempt — co-managed archive file ledger, written by the retainFile primitive
        await owner.table(TABLE).where('archive_file_id', row.archive_file_id).update({ status: 'ready', staged_bytes: null, stored_at: trx.raw('now()'), error_code: null });
        return true;
      });
      if (stored) result.stored++;
    } catch {
      result.failed++;
      // write-admission: exempt — co-managed archive file ledger, written by the retainFile primitive
      await tenantDb(db, tenant).table(TABLE).where({ archive_file_id: candidate.archive_file_id, status: 'pending' }).update({ attempts: db.raw('attempts + 1'),
        error_code: 'archive_storage_failed', next_attempt_at: db.raw("now() + least(3600, power(2, least(attempts, 10)) * 60) * interval '1 second'") });
    }
  }
  return result;
}
