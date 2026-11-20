'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { uploadDocument } from '@alga-psa/documents/actions/documentActions';

/** Use the shared document upload engine with this task as the association target. */
export async function uploadProjectTaskCommentDocument(
  formData: FormData,
  params: { userId: string; projectTaskId: string },
) {
  return uploadDocument(formData, params);
}

/** Withdraw only this actor's drafts for this task. Saved attachments are never touched. */
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
  const rows = await tenantDb(knex, tenant).table('comment_attachment_drafts')
    .where({ entity_type: 'project_task', entity_id: input.projectTaskId, created_by: user.user_id, state: 'draft' })
    .whereNull('comment_id').whereIn('document_id', [...new Set(input.documentIds)])
    .update({ state: 'removed' }).returning('document_id');
  return { deletedDocumentIds: rows.map(row => row.document_id), failures: [] };
});
