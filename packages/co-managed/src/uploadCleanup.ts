import { assertCoManagedAttachmentPath } from './attachmentStoragePath';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

const DRAFTS = 'co_management_conversation_drafts', FILES = 'co_management_conversation_attachments';
export const CO_MANAGED_UPLOAD_RETENTION_DAYS = 7;
const expired = (query: Knex.QueryBuilder) => query.whereRaw("last_activity_at <= clock_timestamp() - ? * interval '1 day'", [CO_MANAGED_UPLOAD_RETENTION_DAYS]);
/** Internal transition under the owning draft lock. Keep its original request
 * hash and file reservations so late retries cannot resurrect abandoned work. */
export async function discardCoManagedDraft(trx: Knex.Transaction, tenant: string, row: any): Promise<void> {
  if (!trx.isTransaction || row.tenant !== tenant || row.status !== 'draft') throw new CoManagedSharedWorkError();
  if (row.abandoned_at) return;
  const owner = tenantDb(trx, tenant), files = await owner.table(FILES).where('draft_operation_id', row.operation_id).forUpdate();
  for (const file of files) if (file.customer_tenant !== row.customer_tenant || file.relationship_id !== row.relationship_id || file.ticket_id !== row.ticket_id ||
    file.thread_id !== row.thread_id || file.comment_id !== row.operation_id || file.actor_tenant !== row.actor_tenant || file.actor_user_id !== row.actor_user_id) throw new CoManagedSharedWorkError();
  await owner.table(DRAFTS).where('operation_id', row.operation_id).update({ abandoned_at: trx.raw('clock_timestamp()') });
  await owner.table(FILES).where('draft_operation_id', row.operation_id).whereNull('discarded_at').update({ discarded_at: trx.raw('clock_timestamp()') });
}
/** Trusted tenant maintenance. Claim invisibility before any external deletion;
 * retrying a failed/lost provider acknowledgement is safe at the same path. */
export async function cleanupCoManagedUploads(db: Knex, tenant: string, remove: (path: string) => Promise<void>, limit = 100) {
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid co-managed upload cleanup request');
  tenant = tenant.toLowerCase();
  const result = { abandonedDrafts: 0, discardedFiles: 0, purgedFiles: 0, completedDrafts: 0, failedFiles: 0 };
  await db.transaction(async trx => {
    const owner = tenantDb(trx, tenant);
    const drafts = await owner.table(DRAFTS).where({ status: 'draft' }).whereNull('abandoned_at').modify(expired)
      .orderBy('last_activity_at').orderBy('operation_id').limit(limit).forUpdate().skipLocked();
    for (const row of drafts) { await discardCoManagedDraft(trx, tenant, row); result.abandonedDrafts++; }
    const files = await owner.table(FILES).where({ status: 'pending' }).whereNull('draft_operation_id').whereNull('discarded_at').modify(expired)
      .orderBy('last_activity_at').orderBy('attachment_id').limit(limit).forUpdate().skipLocked();
    for (const row of files) { await owner.table(FILES).where('attachment_id', row.attachment_id).update({ discarded_at: trx.raw('clock_timestamp()') }); result.discardedFiles++; }
    // Ready editor uploads survive indefinitely while selected by their author's
    // draft. Unselected uploads use the existing abandoned-upload retention.
    // Lock the file before checking selection, matching draft-save file locks.
    const selectedEditor = owner.table('ticket_conversation_editor_drafts as editor').whereRaw('editor.actor_user_id = f.actor_user_id')
      .whereRaw('editor.conversation_store_tenant = f.named_editor_store_tenant AND editor.conversation_id = f.named_editor_conversation_id')
      .whereRaw('editor.ticket_tenant = f.customer_tenant AND editor.ticket_id = f.ticket_id')
      .whereRaw("editor.attachment_manifest @> jsonb_build_array(jsonb_build_object('attachmentId', f.attachment_id::text))");
    const editorFiles = await owner.table(FILES + ' as f').where('status', 'ready').whereNotNull('named_editor_conversation_id').whereNotExists(selectedEditor)
      .whereNull('discarded_at').modify(expired).orderBy('last_activity_at').orderBy('attachment_id').limit(limit).forUpdate().skipLocked();
    for (const row of editorFiles) {
      const selected = await owner.table('ticket_conversation_editor_drafts').where({ actor_user_id: row.actor_user_id,
        conversation_store_tenant: row.named_editor_store_tenant, conversation_id: row.named_editor_conversation_id,
        ticket_tenant: row.customer_tenant, ticket_id: row.ticket_id })
        .whereRaw('attachment_manifest @> ?::jsonb', [JSON.stringify([{ attachmentId: row.attachment_id }])]).first();
      if (selected) continue;
      await owner.table(FILES).where('attachment_id', row.attachment_id).update({ discarded_at: trx.raw('clock_timestamp()') });
      result.discardedFiles++;
    }
  });
  const candidates = await tenantDb(db, tenant).table(FILES).whereNotNull('discarded_at').whereNull('purged_at').where('cleanup_next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .orderBy('cleanup_next_attempt_at').orderBy('attachment_id').limit(limit).select('attachment_id');
  for (const candidate of candidates) {
    try {
      const purged = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant), row = await owner.table(FILES).where('attachment_id', candidate.attachment_id).whereNotNull('discarded_at').whereNull('purged_at')
          .where('cleanup_next_attempt_at', '<=', trx.raw('clock_timestamp()')).forUpdate().skipLocked().first();
        if (!row) return;
        assertCoManagedAttachmentPath(row);
        const explicitRemoval = row.status === 'ready' && row.removal_actor_tenant === row.actor_tenant && row.removal_actor_user_id === row.actor_user_id;
        if (row.draft_operation_id) {
          const draft = await owner.table(DRAFTS).where('operation_id', row.draft_operation_id).first();
          if (!draft || draft.customer_tenant !== row.customer_tenant || draft.relationship_id !== row.relationship_id || draft.ticket_id !== row.ticket_id ||
            draft.thread_id !== row.thread_id || draft.operation_id !== row.comment_id ||
            (explicitRemoval ? draft.status !== 'published' || draft.abandoned_at : draft.status !== 'draft' || !draft.abandoned_at)) throw new Error('Invalid cleanup draft');
        } else if (row.named_editor_conversation_id) {
          if (row.comment_id || row.thread_id || row.tenant !== row.actor_tenant || !row.actor_user_id) throw new Error('Invalid editor cleanup binding');
        } else if (row.status !== 'pending' && !explicitRemoval) throw new Error('Published attachments require explicit deletion');
        await remove(row.storage_path);
        await owner.table(FILES).where('attachment_id', row.attachment_id).update({ purged_at: trx.raw('clock_timestamp()'), file_name: 'Removed attachment',
          mime_type: 'application/octet-stream', cleanup_error_code: null });
        return true;
      });
      if (purged) result.purgedFiles++;
    } catch {
      result.failedFiles++;
      await tenantDb(db, tenant).table(FILES).where('attachment_id', candidate.attachment_id).whereNotNull('discarded_at').whereNull('purged_at').update({
        cleanup_attempts: db.raw('cleanup_attempts + 1'), cleanup_error_code: 'attachment_cleanup_failed',
        cleanup_next_attempt_at: db.raw("clock_timestamp() + least(3600, power(2, least(cleanup_attempts, 10)) * 60) * interval '1 second'"),
      });
    }
  }
  await db.transaction(async trx => {
    const owner = tenantDb(trx, tenant);
    const unfinished = owner.table(FILES + ' as f').whereRaw('f.draft_operation_id = d.operation_id').whereNull('f.purged_at');
    const drafts = await owner.table(DRAFTS + ' as d').whereNotNull('d.abandoned_at').whereNull('d.cleanup_completed_at').whereNotExists(unfinished)
      .orderBy('d.abandoned_at').orderBy('d.operation_id').limit(limit).forUpdate().skipLocked();
    for (const row of drafts) {
      if (await owner.table(FILES).where('draft_operation_id', row.operation_id).whereNull('purged_at').first()) continue;
      const manifest = (row.manifest as Array<{ attachmentId: string }>).map(file => ({ attachmentId: file.attachmentId }));
      await owner.table(DRAFTS).where('operation_id', row.operation_id).update({ cleanup_completed_at: trx.raw('clock_timestamp()'),
        request: { operationId: row.operation_id }, manifest: JSON.stringify(manifest) });
      result.completedDrafts++;
    }
  });
  return result;
}
