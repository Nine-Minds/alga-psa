'use server';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { canAccessAttachmentTicket } from '@shared/lib/ticketCommentAttachments';

/** Withdraw only this actor's unclaimed drafts. Never delete a shared document. */
export const discardCommentAttachmentDrafts = withAuth(async (user, { tenant }, input: { ticketId: string; documentIds: string[] }) => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'document', 'create') || !await hasPermission(user, 'ticket', 'update') ||
    !await canAccessAttachmentTicket(knex, tenant, user.user_id, input.ticketId)) {
    throw new Error('Permission denied: Cannot manage attachment drafts for this ticket');
  }
  const rows = await tenantDb(knex, tenant).table('ticket_comment_attachments')
    .where({ ticket_id: input.ticketId, created_by: user.user_id, state: 'draft' })
    .whereIn('document_id', input.documentIds).whereNull('comment_id')
    .update({ state: 'removed' }).returning('document_id');
  return { deletedDocumentIds: rows.map(row => row.document_id), failures: [] };
});
