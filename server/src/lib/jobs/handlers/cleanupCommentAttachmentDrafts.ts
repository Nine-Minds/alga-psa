import type { Knex } from 'knex';
import { tenantDb, withTransaction, runWithTenant } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';

/** Enumerate FK references so new shared-content relationships fail closed too. */
async function references(conn: Knex, target: string) {
  const result = await conn.raw(`SELECT DISTINCT cl.relname AS table_name, a.attname AS column_name
    FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid
    JOIN LATERAL unnest(c.conkey, c.confkey) AS k(local_key, remote_key) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.local_key
    JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.remote_key
    WHERE c.contype='f' AND c.confrelid=?::regclass AND b.attname <> 'tenant'`, [target]);
  return result.rows as Array<{ table_name: string; column_name: string }>;
}

/** 24-hour grace, at most 100 drafts per sweep. Storage deletions are persisted and retryable. */
export async function cleanupCommentAttachmentDrafts(conn: Knex, tenant: string,
  remove = (fileId: string, actorId: string, trx: Knex.Transaction) => StorageService.deleteFile(fileId, actorId, trx)) {
  const db = tenantDb(conn, tenant);
  const candidates = await db.table('ticket_comment_attachments').whereNull('comment_id')
    .whereIn('state', ['draft', 'removed']).where('expires_at', '<=', new Date()).whereNull('cleanup_completed_at')
    .orderBy('expires_at').limit(100);
  const documentRefs = await references(conn, 'documents');
  const fileRefs = await references(conn, 'external_files');
  for (const candidate of candidates) {
    try {
      const staged = await withTransaction(conn, async trx => {
        const scoped = tenantDb(trx, tenant);
        const row = await scoped.table('ticket_comment_attachments').where({ attachment_id: candidate.attachment_id }).forUpdate().first();
        if (!row || row.comment_id || row.state === 'attached' || row.cleanup_completed_at) return null;
        if (row.cleanup_file_ids) return row;
        const preserveSharedContent = async () => {
          // This draft no longer owns cleanup. Do not let preserved rows starve later batches.
          await scoped.table('ticket_comment_attachments').where({ attachment_id: row.attachment_id })
            .update({ cleanup_completed_at: new Date() });
          return null;
        };
        await scoped.table('ticket_comment_attachments').where({ attachment_id: row.attachment_id }).update({ state: 'removed' });
        const document = await scoped.table('documents').where({ document_id: row.document_id }).forUpdate().first();
        if (!document) return preserveSharedContent();
        const associations = await scoped.table('document_associations').where({ document_id: row.document_id });
        if (associations.some(a => a.entity_type !== 'ticket' || a.entity_id !== row.ticket_id)) return preserveSharedContent();
        for (const ref of documentRefs) {
          if (ref.table_name === 'document_associations') continue;
          if (await scoped.table(ref.table_name).where(ref.column_name, row.document_id).first()) return preserveSharedContent();
        }
        const ids = [...new Set([document.file_id, document.preview_file_id].filter(Boolean))] as string[];
        for (const fileId of ids) {
          const file = await scoped.table('external_files').where({ file_id: fileId }).forUpdate().first();
          if (file && await scoped.table('external_files').where({ storage_path: file.storage_path }).whereNot('file_id', fileId).whereNull('deleted_at').first()) return preserveSharedContent();
          if (await scoped.table('documents').whereNot('document_id', row.document_id).where(q => q.where('file_id', fileId).orWhere('preview_file_id', fileId)).first()) return preserveSharedContent();
          for (const ref of fileRefs) {
            const query = scoped.table(ref.table_name).where(ref.column_name, fileId);
            if (ref.table_name === 'documents') query.whereNot('document_id', row.document_id);
            if (await query.first()) return preserveSharedContent();
          }
        }
        // FK locks serialize concurrent association creation; no cascade may remove shared content.
        await scoped.table('document_associations').where({ document_id: row.document_id }).delete();
        await scoped.table('documents').where({ document_id: row.document_id }).delete();
        await scoped.table('ticket_comment_attachments').where({ attachment_id: row.attachment_id })
          .update({ cleanup_file_ids: JSON.stringify(ids), state: 'removed' });
        return { ...row, cleanup_file_ids: ids };
      });
      if (!staged) continue;
      for (const fileId of staged.cleanup_file_ids) {
        await withTransaction(conn, async trx => {
          const scoped = tenantDb(trx, tenant);
          // Recheck after staging and on every retry. Keep the FK lock through physical deletion
          // so a new document cannot acquire this file while storage is being removed.
          const file = await scoped.table('external_files').where({ file_id: fileId }).forUpdate().first();
          if (!file || file.deleted_at) return;
          if (await scoped.table('external_files').where({ storage_path: file.storage_path })
            .whereNot('file_id', fileId).whereNull('deleted_at').first()) return;
          if (await scoped.table('documents').where(q => q.where('file_id', fileId).orWhere('preview_file_id', fileId)).first()) return;
          for (const ref of fileRefs) {
            if (await scoped.table(ref.table_name).where(ref.column_name, fileId).first()) return;
          }
          await runWithTenant(tenant, () => remove(fileId, staged.created_by, trx));
        });
      }
      await db.table('ticket_comment_attachments').where({ attachment_id: staged.attachment_id })
        .update({ cleanup_completed_at: new Date() });
    } catch (error) {
      console.error('Attachment draft cleanup requires retry', { tenant, attachmentId: candidate.attachment_id, error });
    }
  }
  await db.table('ticket_comment_attachment_challenges').where('expires_at', '<', new Date(Date.now() - 86400000)).delete();
}
