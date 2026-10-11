import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { formatCollaborationActorName } from '@alga-psa/event-schemas/collaboration';
import { readTicketNotificationActor } from './ticketNotificationContext';

/** New collaboration events must still identify a current, published comment.
 * A delayed event cannot disclose a deleted body or bypass a narrowed audience.
 * Legacy producers retain their existing payload shape; their internal/public
 * restriction still applies in each recipient adapter. */
export async function resolveTicketCommentNotificationPayload<T extends { tenantId: string; ticketId: string; userId?: string; actorUserId?: string;
  actorType?: string; comment?: { id: string; content: string; author: string; isInternal?: boolean; audience?: string } }>(db: Knex, payload: T): Promise<T | null> {
  const actor = readTicketNotificationActor(payload, payload.tenantId, payload.actorUserId || payload.userId);
  if (!actor.actorReference && !payload.comment?.audience) return payload;
  if (!payload.comment) return null;
  const owner = tenantDb(db, payload.tenantId);
  const query = owner.table('comments as c').where({ 'c.comment_id': payload.comment.id, 'c.ticket_id': payload.ticketId, 'c.publish_state': 'published' }).whereNull('c.deleted_at');
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
  owner.tenantJoin(query, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id', { type: 'left' });
  const row = await query.where('root.publish_state', 'published').select({ audience: commentAudienceSql(db, 't', 'root', 'c'),
    user_id: 'c.user_id', actor_reference_id: 'c.actor_reference_id', actor_tenant: 'a.actor_tenant', actor_user_id: 'a.actor_user_id',
    actor_display_name: 'c.actor_display_name', actor_organization_name: 'c.actor_organization_name', note: 'c.note' }).first();
  if (!row || row.audience !== payload.comment.audience || payload.comment.isInternal !== (row.audience !== 'requester')) return null;
  if (actor.actorReference) {
    const reference = actor.actorReference;
    if (row.user_id || row.actor_reference_id !== reference.referenceId || row.actor_tenant !== reference.tenantId || row.actor_user_id !== reference.userId ||
        row.actor_display_name !== reference.displayName || row.actor_organization_name !== reference.organizationName || row.audience === 'organization_private') return null;
  } else if (row.actor_reference_id || row.user_id !== actor.userId) return null;
  return { ...payload, comment: { ...payload.comment, content: row.note ?? '',
    author: actor.actorReference ? formatCollaborationActorName(actor.actorReference) : payload.comment.author } };
}
