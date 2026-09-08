import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { assertCoManagedAttachmentPath } from './attachmentStoragePath';
import { hasEffectiveSharedGrant } from './effectiveSharedGrant';
import { participationEvidenceTable } from './participationEvidenceStore';
import type { CoManagedSharedResource } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

const TABLE = 'co_managed_archive_files';
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function coManagedArchiveFilePath(tenant: string, archiveFileId: string): string {
  if (![tenant, archiveFileId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return `co-management-archive/${tenant}/${archiveFileId}`;
}

/** Capture only an admitted, published customer comment while its work is shared.
 * The transaction owns a byte snapshot before trust can close or cleanup can
 * delete the source. A later worker moves those already-owned bytes to storage;
 * it never reopens the customer object or needs renewed collaboration authority.
 * Draft publication/disclosure reads the confirmed immutable object; a current
 * upload supplies the exact same bytes without another storage round trip. */
export async function stageCoManagedConversationFiles(trx: Knex.Transaction, tenant: string, ticketId: string, commentId: string,
  uploaded?: { attachmentId: string; content: Uint8Array }): Promise<void> {
  if (!trx.isTransaction || ![tenant, ticketId, commentId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const supplied = uploaded ? { attachmentId: uploaded.attachmentId, content: Buffer.from(uploaded.content) } : undefined;
  const owner = tenantDb(trx, tenant);
  const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at').forShare()
    .first('relationship_id', 'sponsor_tenant', 'sponsor_client_id');
  if (!relationship) return;
  const resource = { tenant, relationshipId: relationship.relationship_id, kind: 'ticket' as const, id: ticketId };
  if (!await hasEffectiveSharedGrant(trx, resource)) return;
  const query = owner.table('comments as c').where({ 'c.comment_id': commentId, 'c.ticket_id': ticketId });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 'c.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
  const comment = await query.where('c.publish_state', 'published').where('root.publish_state', 'published').whereNull('c.deleted_at').whereNull('root.deleted_at')
    .forShare('c', 't', 'root').select('c.thread_id', 'c.actor_reference_id', { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
  if (!comment || !['requester', 'shared_it'].includes(comment.audience)) return;
  const sponsor = tenantDb(trx, relationship.sponsor_tenant), workKey = { customer_tenant: tenant, relationship_id: resource.relationshipId };
  const participated = await sponsor.table(participationEvidenceTable).where({ ...workKey, resource_type: 'ticket', resource_id: ticketId }).first('evidence_id') ||
    await sponsor.table('co_managed_ticket_references').where({ ...workKey, ticket_id: ticketId, client_id: relationship.sponsor_client_id }).forShare().first('reference_id');
  if (!participated && (!comment.actor_reference_id || !await owner.table('collaboration_actor_references')
    .where({ actor_reference_id: comment.actor_reference_id, actor_tenant: relationship.sponsor_tenant }).forShare().first('actor_reference_id'))) return;
  const files = await publishedFiles(trx, tenant, resource, comment.thread_id, commentId, supplied?.attachmentId);
  await stageFiles(trx, relationship.sponsor_tenant, relationship.sponsor_client_id, comment.audience, files, supplied?.content);
}

/** Own private notes remain an MSP business record. Their persisted work proof
 * supplies the client identity; no customer content or grant is reopened. */
export async function stageCoManagedPrivateConversationFiles(trx: Knex.Transaction, tenant: string, resource: CoManagedSharedResource, commentId: string,
  uploaded?: { attachmentId: string; content: Uint8Array }): Promise<void> {
  if (!trx.isTransaction || resource.kind !== 'ticket' || tenant === resource.tenant || ![tenant, resource.tenant, resource.relationshipId, resource.id, commentId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const supplied = uploaded ? { attachmentId: uploaded.attachmentId, content: Buffer.from(uploaded.content) } : undefined;
  const owner = tenantDb(trx, tenant), query = owner.table('co_management_private_comments as c').where('c.comment_id', commentId).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'co_management_private_threads as t', 'c.thread_id', 't.thread_id');
  owner.tenantJoin(query, 'co_management_private_comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id') });
  const comment = await query.where({ 't.customer_tenant': resource.tenant, 't.relationship_id': resource.relationshipId, 't.resource_type': 'ticket', 't.resource_id': resource.id })
    .whereNull('t.disclosure_operation_id').forShare('c', 't', 'root').first('c.thread_id');
  if (!comment) return;
  const evidence = await owner.table(participationEvidenceTable).where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    resource_type: 'ticket', resource_id: resource.id }).distinct('client_id').limit(2);
  if (evidence.length !== 1) throw new CoManagedSharedWorkError();
  const files = await publishedFiles(trx, tenant, resource, comment.thread_id, commentId, supplied?.attachmentId);
  await stageFiles(trx, tenant, evidence[0].client_id, 'organization_private', files, supplied?.content);
}

async function publishedFiles(trx: Knex.Transaction, storeTenant: string, resource: CoManagedSharedResource, threadId: string, commentId: string, attachmentId?: string) {
  const owner = tenantDb(trx, storeTenant);
  const publishedDraft = owner.table('co_management_conversation_drafts as d').where({ 'd.status': 'published', 'd.customer_tenant': resource.tenant,
    'd.relationship_id': resource.relationshipId, 'd.ticket_id': resource.id, 'd.thread_id': threadId, 'd.operation_id': commentId })
    .whereRaw('d.operation_id = f.draft_operation_id').whereNull('d.abandoned_at');
  return owner.table('co_management_conversation_attachments as f').where({ 'f.customer_tenant': resource.tenant, 'f.relationship_id': resource.relationshipId,
    'f.ticket_id': resource.id, 'f.thread_id': threadId, 'f.comment_id': commentId, 'f.status': 'ready' }).whereNull('f.discarded_at').whereNull('f.purged_at')
    .where(q => q.whereNull('f.draft_operation_id').orWhereExists(publishedDraft))
    .modify(q => { if (attachmentId) q.where('f.attachment_id', attachmentId); }).orderBy('f.attachment_id').forShare('f').select('f.*');
}

/** Source adapters own publication/audience admission; both use one immutable
 * byte snapshot and retry protocol after proving that source. */
async function stageFiles(trx: Knex.Transaction, tenant: string, clientId: string, audience: string, files: any[], supplied?: Uint8Array) {
  const owner = tenantDb(trx, tenant);
  for (const file of files) {
    const key = { customer_tenant: file.customer_tenant, relationship_id: file.relationship_id, source_tenant: file.tenant, attachment_id: file.attachment_id };
    const retained = await owner.table(TABLE).where(key).first('content_hash');
    if (retained) {
      if (retained.content_hash !== file.content_hash) throw new Error('Retained archive file identity was reused');
      continue;
    }
    const path = assertCoManagedAttachmentPath(file);
    const bytes = supplied ? Buffer.from(supplied) : Buffer.from(await (await StorageProviderFactory.createProvider()).download(path));
    if (bytes.length !== file.file_size || checksum(bytes) !== file.content_hash) throw new Error('Archive source attachment failed integrity verification');
    await owner.table(TABLE).insert({ tenant, archive_file_id: randomUUID(), ...key,
      client_id: clientId, ticket_id: file.ticket_id, thread_id: file.thread_id, comment_id: file.comment_id,
      audience, file_name: file.file_name, mime_type: file.mime_type, file_size: file.file_size, content_hash: file.content_hash,
      staged_bytes: bytes, captured_at: trx.raw('clock_timestamp()') }).onConflict(['tenant', ...Object.keys(key)]).ignore();
  }
}

/** Tenant maintenance consumes only MSP-owned immutable staging. A lost provider
 * acknowledgement retries the same owner-qualified object; ready rows never
 * change. Pending bytes are retained until complete object storage is confirmed. */
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
        const path = coManagedArchiveFilePath(tenant, row.archive_file_id), provider = await StorageProviderFactory.createProvider();
        const uploaded = await provider.upload(row.staged_bytes, path, { mime_type: row.mime_type });
        if (uploaded.path !== path || uploaded.size !== row.file_size) throw new Error('Archive storage did not confirm the complete object');
        await owner.table(TABLE).where('archive_file_id', row.archive_file_id).update({ status: 'ready', staged_bytes: null, stored_at: trx.raw('clock_timestamp()'), error_code: null });
        return true;
      });
      if (stored) result.stored++;
    } catch {
      result.failed++;
      await tenantDb(db, tenant).table(TABLE).where({ archive_file_id: candidate.archive_file_id, status: 'pending' }).update({ attempts: db.raw('attempts + 1'),
        error_code: 'archive_storage_failed', next_attempt_at: db.raw("clock_timestamp() + least(3600, power(2, least(attempts, 10)) * 60) * interval '1 second'") });
    }
  }
  return result;
}
