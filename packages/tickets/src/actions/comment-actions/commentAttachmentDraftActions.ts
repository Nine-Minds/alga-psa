'use server';
import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

/** Withdraw only this actor's unclaimed drafts. Never delete a shared document. */
export const discardCommentAttachmentDrafts = withAuth(async (user, { tenant }, input: { ticketId: string; documentIds: string[] }) => {
  const { knex } = await createTenantKnex();
  const rows = await tenantDb(knex, tenant).table('ticket_comment_attachments')
    .where({ ticket_id: input.ticketId, created_by: user.user_id, state: 'draft' })
    .whereIn('document_id', input.documentIds.slice(0, 100)).whereNull('comment_id')
    .update({ state: 'removed' }).returning('document_id');
  return { deletedDocumentIds: rows.map(row => row.document_id), failures: [] };
});
