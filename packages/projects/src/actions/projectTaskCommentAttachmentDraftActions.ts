'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { deleteDocument, uploadDocument } from '@alga-psa/documents/actions/documentActions';

/** Use the shared document upload engine with this task as the association target. */
export async function uploadProjectTaskCommentDocument(
  formData: FormData,
  params: { userId: string; projectTaskId: string },
) {
  return uploadDocument(formData, params);
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
  const db = tenantDb(knex, tenant);
  const draftRows = await db.table('comment_attachment_drafts')
    .where({ entity_type: 'project_task', entity_id: input.projectTaskId, created_by: user.user_id, state: 'draft' })
    .whereNull('comment_id').whereIn('document_id', [...new Set(input.documentIds)])
    .select('document_id');
  const deletedDocumentIds: string[] = [];
  const failures: Array<{ documentId: string; reason: string }> = [];

  for (const draft of draftRows) {
    const document = await db.table('documents').where({ document_id: draft.document_id, created_by: user.user_id })
      .first('document_id', 'file_id');
    if (!document) {
      failures.push({ documentId: draft.document_id, reason: 'draft_document_missing_or_not_owned' });
      continue;
    }
    const associations = await db.table('document_associations').where({ document_id: draft.document_id })
      .select('entity_type', 'entity_id');
    if (associations.some(row => row.entity_type !== 'project_task' || row.entity_id !== input.projectTaskId)) {
      failures.push({ documentId: draft.document_id, reason: 'document_has_other_associations' });
      continue;
    }
    const referenceTokens = [document.file_id, document.document_id].filter(Boolean);
    const referenced = await db.table('project_task_comments').where(builder => {
      referenceTokens.forEach((token, index) => {
        const clause = `note::text LIKE ?`;
        if (index === 0) builder.whereRaw(clause, [`%${token}%`]);
        else builder.orWhereRaw(clause, [`%${token}%`]);
      });
    }).first('task_comment_id');
    if (referenced) {
      failures.push({ documentId: draft.document_id, reason: 'already_referenced' });
      continue;
    }

    const result = await deleteDocument(draft.document_id, user.user_id);
    if (result.success && result.deleted) {
      await db.table('comment_attachment_drafts').where({
        entity_type: 'project_task', entity_id: input.projectTaskId, document_id: draft.document_id,
        created_by: user.user_id, state: 'draft',
      }).whereNull('comment_id').update({ state: 'removed' });
      deletedDocumentIds.push(draft.document_id);
    } else {
      failures.push({ documentId: draft.document_id, reason: result.message || 'delete_failed' });
    }
  }
  return { deletedDocumentIds, failures };
});
