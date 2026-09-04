import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

type Connection = Knex | Knex.Transaction;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Only server upload URLs are claim candidates; ordinary links never adopt documents. */
export function commentAttachmentFileIds(note: unknown): string[] {
  if (typeof note !== 'string') return [];
  const matches = note.matchAll(new RegExp(`/api/documents/(?:view|download)/(${UUID})(?=[^0-9a-f-]|$)`, 'gi'));
  return [...new Set(Array.from(matches, match => match[1].toLowerCase()))];
}

export async function canAccessAttachmentTicket(conn: Connection, tenant: string, userId: string, ticketId: string): Promise<boolean> {
  const db = tenantDb(conn, tenant);
  const user = await db.table('users').where({ user_id: userId, is_inactive: false }).first();
  const ticket = await db.table('tickets').where({ ticket_id: ticketId }).first();
  if (!user || !ticket) return false;
  if (user.user_type === 'internal') return true;
  if (user.user_type !== 'client' || !user.contact_id) return false;
  const contact = await db.table('contacts').where({ contact_name_id: user.contact_id }).first();
  if (!contact?.client_id || contact.client_id !== ticket.client_id) return false;
  if (!contact.portal_visibility_group_id) return true;
  const group = await db.table('client_portal_visibility_groups').where({
    group_id: contact.portal_visibility_group_id, client_id: contact.client_id,
  }).first();
  if (!group) return false;
  return Boolean(await db.table('client_portal_visibility_group_boards').where({
    group_id: group.group_id, board_id: ticket.board_id,
  }).first());
}

export async function isPublicAttachmentComment(conn: Connection, tenant: string, commentId: string, ticketId: string): Promise<boolean> {
  const db = tenantDb(conn, tenant);
  const comment = await db.table('comments').where({ comment_id: commentId, ticket_id: ticketId }).first();
  if (!comment || comment.deleted_at || comment.is_internal || comment.publish_state !== 'published') return false;
  const thread = await db.table('comment_threads').where({ thread_id: comment.thread_id, ticket_id: ticketId }).first();
  return Boolean(thread && !thread.is_internal);
}

/** Must run inside the comment transaction. Row locks serialize competing claims. */
export async function reconcileCommentAttachments(trx: Connection, tenant: string, commentId: string, actorId: string): Promise<void> {
  if (!trx.isTransaction) throw new Error('Attachment reconciliation requires the comment transaction');
  const db = tenantDb(trx, tenant);
  const comment = await db.table('comments').where({ comment_id: commentId }).forUpdate().first();
  if (!comment) throw new Error('Attachment comment not found');
  const fileIds = commentAttachmentFileIds(comment.note);
  const docs = fileIds.length ? await db.table('documents').whereIn('file_id', fileIds).select('document_id') : [];
  const documentIds = docs.map(d => d.document_id);
  const rows = await db.table('ticket_comment_attachments').where(builder => {
    builder.where('comment_id', commentId);
    if (documentIds.length) builder.orWhereIn('document_id', documentIds);
  }).orderBy('attachment_id').forUpdate();
  if (!rows.length) return;
  if (!await canAccessAttachmentTicket(trx, tenant, actorId, comment.ticket_id)) throw new Error('Attachment ticket access denied');
  for (const row of rows) {
    const retained = documentIds.includes(row.document_id) && !comment.deleted_at && comment.publish_state !== 'canceled';
    if (retained) {
      if (row.ticket_id !== comment.ticket_id || (row.comment_id && row.comment_id !== commentId)) {
        throw new Error('Attachment belongs to another ticket or comment');
      }
      if (!row.comment_id && (row.state !== 'draft' || row.created_by !== actorId || new Date(row.expires_at).getTime() <= Date.now())) {
        throw new Error('Attachment draft is expired or belongs to another user');
      }
      await db.table('ticket_comment_attachments').where({ attachment_id: row.attachment_id }).update({ comment_id: commentId, state: 'attached' });
    } else if (row.comment_id === commentId) {
      await db.table('ticket_comment_attachments').where({ attachment_id: row.attachment_id }).update({ state: 'removed' });
    }
  }
}

/** An additional gate, never an alternative to existing document authorization. */
export async function canReadCommentAttachment(conn: Connection, tenant: string, userId: string, documentId: string): Promise<boolean> {
  const db = tenantDb(conn, tenant);
  const row = await db.table('ticket_comment_attachments').where({ document_id: documentId }).first();
  if (!row) return true; // Existing Documents uploads retain their original policy.
  if (!await canAccessAttachmentTicket(conn, tenant, userId, row.ticket_id)) return false;
  const user = await db.table('users').where({ user_id: userId }).first();
  if (row.state === 'draft') return row.created_by === userId && new Date(row.expires_at).getTime() > Date.now();
  if (row.state !== 'attached' || !row.comment_id) return false;
  const comment = await db.table('comments').where({ comment_id: row.comment_id, ticket_id: row.ticket_id }).first();
  if (!comment || comment.deleted_at || comment.publish_state === 'canceled') return false;
  return user?.user_type === 'internal' || await isPublicAttachmentComment(conn, tenant, row.comment_id, row.ticket_id);
}

export async function listPublishedCommentAttachments(conn: Connection, tenant: string, ticketId: string, commentId: string) {
  if (!await isPublicAttachmentComment(conn, tenant, commentId, ticketId)) return [];
  const db = tenantDb(conn, tenant);
  const query = db.table('ticket_comment_attachments as a').where({ 'a.ticket_id': ticketId, 'a.comment_id': commentId, 'a.state': 'attached' });
  db.tenantJoin(query, 'documents as d', 'a.document_id', 'd.document_id');
  return query.select('d.document_id', 'd.file_id', 'd.document_name', 'd.mime_type', 'd.file_size').orderBy('a.attachment_id');
}

/** Tombstone abandoned uploads; leave documents, associations and shared storage intact. */
export async function expireCommentAttachmentDrafts(conn: Connection, tenant: string): Promise<number> {
  return tenantDb(conn, tenant).table('ticket_comment_attachments')
    .where({ state: 'draft' }).where('expires_at', '<=', new Date()).update({ state: 'removed' });
}

export async function filterReadableCommentAttachments<T extends { document_id: string }>(conn: Connection, tenant: string, userId: string, documents: T[]): Promise<T[]> {
  const allowed = await Promise.all(documents.map(doc => canReadCommentAttachment(conn, tenant, userId, doc.document_id)));
  return documents.filter((_, index) => allowed[index]);
}

export async function withdrawCommentAttachments(conn: Connection, tenant: string, commentId: string) {
  if (!conn.isTransaction) throw new Error('Attachment withdrawal requires the comment transaction');
  await tenantDb(conn, tenant).table('ticket_comment_attachments').where({ comment_id: commentId }).update({ state: 'removed' });
}
