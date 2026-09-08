import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import type { TicketCommentNotificationContent } from './ticketCommentNotificationContent';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Candidate-only discovery for the existing requester recipient matrix. A
 * follow never grants ticket access and cannot enroll another conversation. */
export async function requesterConversationFollowers(db: Knex, ownerTenant: string, ticketId: string, commentId: string, actorTenant: string): Promise<string[]> {
  const owner = tenantDb(db, ownerTenant);
  const query = owner.table('comments as c').where({ 'c.ticket_id': ticketId, 'c.comment_id': commentId, 'c.publish_state': 'published' }).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'ticket_conversations as n', 't.conversation_id', 'n.conversation_id', { on: join => join.andOn('n.ticket_tenant', '=', 'c.tenant').andOn('n.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'ticket_conversation_preferences as p', 'n.conversation_id', 'p.conversation_id');
  const rows = await query.where({ 'n.audience': 'requester', 'p.actor_tenant': actorTenant, 'p.following': true, 'root.publish_state': 'published' })
    .whereRaw('? = ?', [commentAudienceSql(db, 't', 'root', 'c'), 'requester']).distinct('p.actor_user_id');
  return rows.map(row => row.actor_user_id);
}

/** Called with current recipient, named container and message locks already
 * retained by the shared notification content reader. */
export async function isRequesterConversationFollower(context: { trx: Knex.Transaction; actor: { tenant: string; userId: string }; redactedFields: readonly string[] },
  message: TicketCommentNotificationContent<{ tenant: string; id: string }>): Promise<boolean> {
  if (message.audience !== 'requester' || !message.conversationTarget ||
      isCoManagedReadFieldHidden(context.redactedFields, ['ticket_conversation_preferences', 'following'])) return false;
  const preference = await tenantDb(context.trx, message.conversationTarget.storeTenant).table('ticket_conversation_preferences')
    .where({ conversation_id: message.conversationTarget.conversationId, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId }).forShare().first('following');
  return preference?.following === true;
}
