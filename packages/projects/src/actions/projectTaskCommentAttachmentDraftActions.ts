'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { deleteDocument, uploadDocument } from '@alga-psa/documents/actions/documentActions';

/** Use the shared document upload engine with this task as the association target. */
export async function uploadProjectTaskCommentDocument(
  formData: FormData,
  params: { userId: string; projectTaskId: string },
) {
  return uploadDocument(formData, params);
}

/** Claim only unpromoted drafts. Comment promotion takes the same row lock in its save transaction. */
export async function claimProjectTaskCommentDraftsForDiscard(
  conn: Parameters<typeof withTransaction>[0],
  tenant: string,
  projectTaskId: string,
  userId: string,
  documentIds: string[],
) {
  return withTransaction(conn, async trx => {
    const db = tenantDb(trx, tenant);
    const rows = await db.table('comment_attachment_drafts')
      .where({ entity_type: 'project_task', entity_id: projectTaskId, created_by: userId, state: 'draft' })
      .whereNull('comment_id').whereIn('document_id', [...new Set(documentIds)])
      .orderBy('draft_id').forUpdate();
    const claimed: Array<{ document_id: string }> = [];
    const failures: Array<{ documentId: string; reason: string }> = [];
    for (const row of rows) {
      const document = await db.table('documents').where({ document_id: row.document_id, created_by: userId })
        .first('document_id');
      const associations = await db.table('document_associations').where({ document_id: row.document_id })
        .select('entity_type', 'entity_id');
      if (!document || associations.some(association => association.entity_type !== 'project_task' || association.entity_id !== projectTaskId)) {
        failures.push({ documentId: row.document_id, reason: 'draft_document_missing_or_has_other_associations' });
        continue;
      }
      await db.table('comment_attachment_drafts').where({ draft_id: row.draft_id, state: 'draft' })
        .whereNull('comment_id').update({ state: 'removed', expires_at: new Date() });
      claimed.push({ document_id: row.document_id });
    }
    return { claimed, failures };
  });
}

/** Delete only this actor's unclaimed uploads for this task. Saved/shared files are never touched. */
export const discardProjectTaskCommentAttachmentDrafts = withAuth(async (user, { tenant }, input: {
  projectTaskId: string;
  documentIds: string[];
}) => {
  if (!input?.projectTaskId || !Array.isArray(input.documentIds)) throw new Error('Invalid project task attachment draft request');
  if (!await hasPermission(user, 'document', 'create') ||
      !await hasPermission(user, 'project_task', 'create') && !await hasPermission(user, 'project_task', 'update')) {
    throw new Error('Permission denied: Cannot manage attachment drafts for this project task');
  }
  const { knex } = await createTenantKnex();
  const { claimed, failures } = await claimProjectTaskCommentDraftsForDiscard(
    knex, tenant, input.projectTaskId, user.user_id, input.documentIds,
  );
  const deletedDocumentIds: string[] = [];
  for (const draft of claimed) {
    const result = await deleteDocument(draft.document_id, user.user_id);
    if (result.success && result.deleted) {
      deletedDocumentIds.push(draft.document_id);
    } else {
      failures.push({ documentId: draft.document_id, reason: result.message || 'delete_failed' });
    }
  }
  return { deletedDocumentIds, failures };
});
