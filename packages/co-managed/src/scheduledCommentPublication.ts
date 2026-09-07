import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { coManagedConversationBodySources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** A schedule is deferred authorship, not a standing permission grant. Retain
 * current author, RBAC/bundle, ticket and thread locks until visibility commits.
 * Already-published event recovery intentionally does not call this write gate. */
export async function assertCoManagedScheduledCommentPublication(trx: Knex.Transaction,
  input: { tenant: string; ticketId: string; commentId: string }): Promise<{ canUpdateResponseState: boolean } | null> {
  if (!trx.isTransaction || ![input.tenant, input.ticketId, input.commentId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  await assertCoManagedOperationalWrite(trx, input.tenant);
  const owner = tenantDb(trx, input.tenant), tenant = await owner.table('tenants').forShare().first();
  if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
  const locator = await owner.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId }).first('user_id', 'thread_id');
  if (!locator?.user_id || !locator.thread_id) throw new CoManagedSharedWorkError();
  const actor = { tenant: input.tenant, userId: locator.user_id }, subject = await lockCoManagedRecipientIdentity(trx, actor);
  const ticket = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!ticket) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern customer-ticket-policy-record — deferred authorship retains the same current ticket projection as local and email writes.
  const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
    assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
  let canUpdateResponseState = true;
  for (const action of ['read', 'update'] as const) {
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
    if (isCoManagedReadFieldHidden(decision.redactedFields, [...coManagedConversationBodySources, 'comments', 'comment_threads', 'comment_id'])) throw new CoManagedSharedWorkError();
    if (isCoManagedReadFieldHidden(decision.redactedFields, ['response_state'])) canUpdateResponseState = false;
  }
  if (!await owner.table('comment_threads').where({ thread_id: locator.thread_id, ticket_id: input.ticketId }).forUpdate().first()) throw new CoManagedSharedWorkError();
  const query = owner.table('comments as c').where({ 'c.comment_id': input.commentId, 'c.ticket_id': input.ticketId, 'c.thread_id': locator.thread_id });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
  const comment = await query.forUpdate('c', 't', 'root').select('c.*', 'root.publish_state as root_state', 'root.deleted_at as root_deleted_at',
    { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
  if (comment && comment.publish_state !== 'scheduled') return null;
  if (!comment || comment.user_id !== actor.userId || comment.author_type !== 'internal' || comment.actor_reference_id || comment.contact_id ||
      comment.deleted_at || comment.is_system_generated || comment.publish_state !== 'scheduled' || comment.audience !== 'requester' ||
      (comment.parent_comment_id && (comment.root_state !== 'published' || comment.root_deleted_at))) throw new CoManagedSharedWorkError();
  await assertCoManagedOperationalWrite(trx, input.tenant);
  return { canUpdateResponseState };
}
