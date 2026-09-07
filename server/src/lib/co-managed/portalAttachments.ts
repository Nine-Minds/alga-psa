import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { getClientContactVisibilityContext } from '@alga-psa/tickets/lib/clientPortalVisibility.server';
import { applyVisibilityBoardFilter } from '@alga-psa/tickets/lib';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired,
  listPublishedCoManagedAttachments, readPublishedCoManagedAttachment, type CoManagedSessionActor, type CoManagedAttachmentReadContext } from '@alga-psa/co-managed';

export interface PortalAttachmentTarget { ticketId: string; threadId: string; commentId: string }
const deny = (): never => { throw new CoManagedSharedWorkError(); };
/** Requesters use their own customer identity and portal visibility, not the MSP
 * relationship grant. Retained customer files remain readable after departure. */
async function withPortalComment<T>(db: Knex, inputActor: CoManagedSessionActor, input: PortalAttachmentTarget,
  work: (context: CoManagedAttachmentReadContext) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!input || Object.keys(input).some(key => !['ticketId', 'threadId', 'commentId'].includes(key)) ||
      ![input.ticketId, input.threadId, input.commentId].every(isCoManagedUuid)) deny();
  const ticketId = input.ticketId.toLowerCase(), threadId = input.threadId.toLowerCase(), commentId = input.commentId.toLowerCase();
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, actor.tenant);
    const user = await owner.table('users').where({ user_id: actor.userId, user_type: 'client', is_inactive: false }).forShare().first('contact_id');
    if (!user?.contact_id || !await owner.table('sessions').where({ session_id: actor.sessionId, user_id: actor.userId }).whereNull('revoked_at').forShare().first()) deny();
    await assertCoManagedSessionUnexpired(trx, actor);
    // LEVERAGE: pattern retained-local-rbac — requester file reads retain the same grant rows as technician reads, with portal role flags.
    const permission = owner.table('user_roles as ur').where('ur.user_id', actor.userId);
    owner.tenantJoin(permission, 'roles as r', 'ur.role_id', 'r.role_id');
    owner.tenantJoin(permission, 'role_permissions as rp', 'r.role_id', 'rp.role_id');
    owner.tenantJoin(permission, 'permissions as p', 'rp.permission_id', 'p.permission_id');
    if (!await permission.where({ 'r.client': true, 'p.client': true, 'p.resource': 'ticket', 'p.action': 'read' }).forShare().first('p.permission_id')) deny();
    const contact = await owner.table('contacts').where('contact_name_id', user.contact_id).forShare().first('is_inactive');
    if (!contact || contact.is_inactive === true) deny();
    const visibility = await getClientContactVisibilityContext(trx, actor.tenant, user.contact_id, { lock: true });
    if (!await owner.table('tickets as t').where({ 't.ticket_id': ticketId, 't.client_id': visibility.clientId })
      .modify(query => applyVisibilityBoardFilter(query, visibility.visibleBoardIds)).forShare().first('t.ticket_id')) deny();
    const query = owner.table('comments as c').where({ 'c.ticket_id': ticketId, 'c.thread_id': threadId, 'c.comment_id': commentId });
    owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
    owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.ticket_id', '=', 'c.ticket_id').andOn('root.thread_id', '=', 't.thread_id') });
    if (!await query.where({ 'c.publish_state': 'published', 'root.publish_state': 'published' }).whereNull('c.deleted_at')
      .whereRaw('? = ?', [commentAudienceSql(trx, 't', 'root', 'c'), 'requester']).forShare('c', 't', 'root').first('c.comment_id')) deny();
    await assertCoManagedSessionUnexpired(trx, actor);
    // A root tombstone does not hide surviving requester-facing replies.
    const result = await work({ trx, resource: { tenant: actor.tenant, id: ticketId }, audience: 'requester',
      comment: { storeTenant: actor.tenant, threadId, commentId } });
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}
export async function listPortalConversationAttachments(db: Knex, actor: CoManagedSessionActor, target: PortalAttachmentTarget) {
  return withPortalComment(db, actor, target, listPublishedCoManagedAttachments);
}
export async function downloadPortalConversationAttachment(db: Knex, actor: CoManagedSessionActor, target: PortalAttachmentTarget,
  attachmentId: string, download: (path: string) => Promise<Uint8Array>) {
  if (!isCoManagedUuid(attachmentId)) deny();
  const id = attachmentId.toLowerCase();
  return withPortalComment(db, actor, target, context => readPublishedCoManagedAttachment(context, id, download));
}
