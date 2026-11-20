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

type DraftSource = {
  table: 'ticket_comment_attachments' | 'comment_attachment_drafts';
  key: 'attachment_id' | 'draft_id';
  entityType: 'ticket' | 'project_task';
  entityIdField: 'ticket_id' | 'entity_id';
};

/** 24-hour grace, at most 100 drafts per source. Storage deletions are persisted and retryable. */
export async function cleanupCommentAttachmentDrafts(conn: Knex, tenant: string,
  remove = (fileId: string, actorId: string, trx: Knex.Transaction) => StorageService.deleteFile(fileId, actorId, trx)) {
  const db = tenantDb(conn, tenant);
  const sources: DraftSource[] = [
    { table: 'ticket_comment_attachments', key: 'attachment_id', entityType: 'ticket', entityIdField: 'ticket_id' },
    { table: 'comment_attachment_drafts', key: 'draft_id', entityType: 'project_task', entityIdField: 'entity_id' },
  ];
  const documentRefs = await references(conn, 'documents');
  const fileRefs = await references(conn, 'external_files');

  for (const source of sources) {
    const query = db.table(source.table).whereNull('comment_id')
      .whereIn('state', ['draft', 'removed']).where('expires_at', '<=', new Date()).whereNull('cleanup_completed_at');
    if (source.table === 'comment_attachment_drafts') query.where({ entity_type: 'project_task' });
    const candidates = await query.orderBy('expires_at').limit(100);
    for (const candidate of candidates) {
      const candidateKey = candidate[source.key];
      try {
        const staged = await withTransaction(conn, async trx => {
          const scoped = tenantDb(trx, tenant);
          const row = await scoped.table(source.table).where({ [source.key]: candidateKey }).forUpdate().first();
          if (!row || row.comment_id || row.state === 'attached' || row.cleanup_completed_at) return null;
          if (row.cleanup_file_ids) return row;
          const entityId = row[source.entityIdField];
          const preserveSharedContent = async () => {
            await scoped.table(source.table).where({ [source.key]: candidateKey }).update({ cleanup_completed_at: new Date() });
            return null;
          };
          await scoped.table(source.table).where({ [source.key]: candidateKey }).update({ state: 'removed' });
          const document = await scoped.table('documents').where({ document_id: row.document_id }).forUpdate().first();
          if (!document) return preserveSharedContent();
          const associations = await scoped.table('document_associations').where({ document_id: row.document_id });
          if (associations.some(a => a.entity_type !== source.entityType || a.entity_id !== entityId)) return preserveSharedContent();
          if (source.entityType === 'project_task') {
            const tokens = [document.file_id, document.document_id].filter(Boolean);
            const referencedComment = await scoped.table('project_task_comments').where(builder => {
              tokens.forEach((token, index) => {
                const clause = 'note::text LIKE ?';
                if (index === 0) builder.whereRaw(clause, [`%${token}%`]);
                else builder.orWhereRaw(clause, [`%${token}%`]);
              });
            }).first('task_comment_id');
            if (referencedComment) return preserveSharedContent();
          }
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
          await scoped.table('document_associations').where({ document_id: row.document_id }).delete();
          await scoped.table('documents').where({ document_id: row.document_id }).delete();
          await scoped.table(source.table).where({ [source.key]: candidateKey })
            .update({ cleanup_file_ids: JSON.stringify(ids), state: 'removed' });
          return { ...row, cleanup_file_ids: ids };
        });
        if (!staged) continue;
        for (const fileId of staged.cleanup_file_ids) {
          await withTransaction(conn, async trx => {
            const scoped = tenantDb(trx, tenant);
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
        await db.table(source.table).where({ [source.key]: candidateKey }).update({ cleanup_completed_at: new Date() });
      } catch (error) {
        console.error('Attachment draft cleanup requires retry', { tenant, draftId: candidateKey, error });
      }
    }
  }
  await db.table('ticket_comment_attachment_challenges').where('expires_at', '<', new Date(Date.now() - 86400000)).delete();
}
