'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';

/** Withdraw the editor's uploads immediately. The recovery worker reclaims their unshared files. */
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
  return withTransaction(knex, async trx => {
    const db = tenantDb(trx, tenant);
    // Lock in the same order as promotion. A committed attachment cannot be withdrawn.
    const owned = await db.table('comment_attachment_drafts')
      .where({ entity_type: 'project_task', entity_id: input.projectTaskId, created_by: user.user_id })
      .whereNull('comment_id').whereIn('state', ['draft', 'removed'])
      .whereIn('document_id', input.documentIds)
      .orderBy('draft_id').forUpdate().select('draft_id', 'document_id', 'state');
    const drafts = owned.filter(row => row.state === 'draft');
    if (drafts.length) {
      await db.table('comment_attachment_drafts').whereIn('draft_id', drafts.map(row => row.draft_id))
        .update({ state: 'removed', expires_at: trx.fn.now() });
    }
    return { deletedDocumentIds: owned.map(row => row.document_id), failures: [] };
  });
});
