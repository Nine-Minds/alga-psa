import { namedConversationAttentionSources } from './namedConversationAttention';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import { authorizedConversation, withNamedTicketConversation, type NamedConversationPolicyContext } from './namedTicketConversations';
import { namedConversationMessageContext } from './namedConversationAttachments';
import { readAuthorizedTicketConversationMessage, type CoManagedConversationAuthor } from './ticketConversation';
import { withCoManagedCustomerCommentNotification } from './customerCommentNotification';
import { withCoManagedNotificationRecipient, type CoManagedNotificationRecipient, type CoManagedNotificationRecipientContext } from './sharedWork';
import { isCoManagedNotificationAssignee } from './ticketCommentRecipients';
import { snapshotCoManagedSessionActor, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface NamedConversationNotificationSource {
  ticket: ConversationTicketReference;
  conversation: TicketConversationReference;
  commentId: string;
  threadId: string;
  sequence: string;
}
export interface NamedConversationNotification {
  resource: { kind: 'ticket'; tenant: string; id: string; relationshipId?: string };
  conversation: Pick<NamedTicketConversation, 'storeTenant' | 'conversationId' | 'name' | 'audience'>;
  commentId: string;
  threadId: string;
  sequence: string;
  audience: NamedTicketConversation['audience'];
  note: string;
  ticketNumber?: string;
  author?: CoManagedConversationAuthor;
  ownerTicket: boolean;
}
export type NamedNotificationContext = { trx: Knex.Transaction; actor: { tenant: string; userId: string } };
const EVENTS = 'ticket_conversation_message_events', PREFS = 'ticket_conversation_preferences';
function snapshotSource(input: NamedConversationNotificationSource): NamedConversationNotificationSource {
  if (!input || Object.keys(input).some(key => !['ticket', 'conversation', 'commentId', 'threadId', 'sequence'].includes(key)) ||
    ![input.commentId, input.threadId].every(conversationUuid) || typeof input.sequence !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input.sequence) || BigInt(input.sequence) > 9223372036854775807n)
    throw new TicketConversationError('CONVERSATION_INVALID');
  return { ticket: snapshotConversationTicket(input.ticket), conversation: snapshotConversationReference(input.conversation),
    commentId: input.commentId.toLowerCase(), threadId: input.threadId.toLowerCase(), sequence: input.sequence };
}

/** A retained publication event is necessary but not sufficient: delivery also
 * retains current recipient identity, ticket/audience, follow/assignment and
 * source locks. Interactive reads use the real session and retain access to old
 * notices after unfollowing, provided their source is still readable. */
export async function withNamedConversationNotification<T>(db: Knex, inputActor: CoManagedNotificationRecipient | CoManagedSessionActor,
  input: NamedConversationNotificationSource, deliver: (context: NamedNotificationContext, message: NamedConversationNotification) => Promise<T>): Promise<T | null> {
  const source = snapshotSource(input);
  const actor = inputActor?.kind === 'session' ? snapshotCoManagedSessionActor(inputActor) : inputActor?.kind === 'notification_recipient' &&
    [inputActor.tenant, inputActor.userId].every(conversationUuid) ? { kind: 'notification_recipient' as const, tenant: inputActor.tenant.toLowerCase(), userId: inputActor.userId.toLowerCase() } : null;
  if (!actor) throw new TicketConversationError('CONVERSATION_INVALID');
  const load = async (context: NamedConversationPolicyContext, assignee?: () => Promise<boolean>): Promise<T | null> => {
    const { conversation } = await authorizedConversation(context, source.conversation);
    if (isCoManagedReadFieldHidden(context.hidden, namedConversationAttentionSources)) return null;
    const store = tenantDb(context.trx, conversation.storeTenant);
    const event = await store.table(EVENTS).where({ conversation_id: conversation.conversationId, ticket_tenant: source.ticket.tenant,
      ticket_id: source.ticket.ticketId, comment_id: source.commentId, thread_id: source.threadId, sequence: source.sequence }).forShare().first();
    if (!event || (event.author_tenant === actor.tenant && event.author_user_id === actor.userId)) return null;
    if (actor.kind === 'notification_recipient') {
      const following = await store.table(PREFS).where({ conversation_id: conversation.conversationId, actor_tenant: actor.tenant, actor_user_id: actor.userId }).forShare().first('following');
      if (!following?.following && (!assignee || !await assignee())) return null;
    }
    await namedConversationMessageContext({ ...context, conversation }, source.commentId, source.threadId);
    const relationshipId = actor.tenant === source.ticket.tenant ? source.ticket.relationshipId : context.ticket.relationshipId;
    const resource = { kind: 'ticket' as const, tenant: context.ticket.tenant, id: context.ticket.ticketId,
      ...(relationshipId ? { relationshipId } : {}) };
    const item = await readAuthorizedTicketConversationMessage({ trx: context.trx, actor: context.actor, resource, redactedFields: context.hidden }, conversation, source);
    if (!item || item.deleted || item.note === null) return null;
    if (conversation.transport === 'email') {
      const { attachPublishedConversationEmails } = await import('./conversationEmailOperations');
      await attachPublishedConversationEmails({ ...context, conversation }, [item]);
    }
    const ticket = await tenantDb(context.trx, source.ticket.tenant).table('tickets').where('ticket_id', source.ticket.ticketId).first('ticket_number');
    if (!ticket) return null;
    return deliver(context, { resource, conversation: { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId, name: conversation.name, audience: conversation.audience },
      commentId: source.commentId, threadId: source.threadId, sequence: source.sequence, audience: conversation.audience, note: item.note,
      ownerTicket: actor.tenant === source.ticket.tenant, ...(item.author ? { author: item.author } : {}),
      ...(!isCoManagedReadFieldHidden(context.hidden, ['ticket_number', 'tickets.ticket_number']) ? { ticketNumber: ticket.ticket_number } : {}) });
  };
  try {
    if (actor.kind === 'session') return await withNamedTicketConversation(db, actor, actor.tenant === source.ticket.tenant
      ? { tenant: source.ticket.tenant, ticketId: source.ticket.ticketId } : source.ticket, source.conversation, 'read', context => load(context));
    if (actor.tenant === source.ticket.tenant) {
      // Owner-local notification admission supports native PSA and retained
      // customer content, without requiring a foreign relationship or license.
      return await withCoManagedCustomerCommentNotification(db, actor, { tenant: source.ticket.tenant, kind: 'ticket', id: source.ticket.ticketId }, source.commentId,
        context => load({ trx: context.trx, actor: context.actor, ticket: source.ticket, shared: true, hidden: context.redactedFields }, async () => {
          const owner = tenantDb(context.trx, actor.tenant);
          const ticket = await owner.table('tickets').where('ticket_id', source.ticket.ticketId).forShare().first('assigned_to', 'assigned_team_id');
          return Boolean(ticket && (ticket.assigned_to === actor.userId || (ticket.assigned_team_id && await owner.table('team_members')
            .where({ team_id: ticket.assigned_team_id, user_id: actor.userId }).forShare().first('user_id'))));
        }));
    }
    const owner = tenantDb(db, source.ticket.tenant);
    const relation = await owner.table('co_management_relationships').where({ sponsor_tenant: actor.tenant, state: 'active' }).whereNull('ended_at')
      .modify(query => { if (source.ticket.relationshipId) query.where('relationship_id', source.ticket.relationshipId); }).first('relationship_id');
    if (!relation) return null;
    const ticket = { ...source.ticket, relationshipId: relation.relationship_id };
    return await withCoManagedNotificationRecipient(db, actor, { kind: 'ticket', tenant: ticket.tenant, id: ticket.ticketId, relationshipId: ticket.relationshipId },
      (context: CoManagedNotificationRecipientContext) => load({ trx: context.trx, actor: context.actor, ticket, shared: true, hidden: context.redactedFields }, () => isCoManagedNotificationAssignee(context)));
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError || (error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) return null;
    throw error;
  }
}

/** Candidate discovery contains no body or notification authority. Each
 * candidate is rechecked above, including a reassignment after this snapshot. */
export async function namedConversationNotificationCandidates(db: Knex, input: NamedConversationNotificationSource): Promise<CoManagedNotificationRecipient[]> {
  const source = snapshotSource(input), store = tenantDb(db, source.conversation.storeTenant), owner = tenantDb(db, source.ticket.tenant);
  const candidates: Array<{ actor_tenant: string; actor_user_id: string }> = await store.table(PREFS)
    .where({ conversation_id: source.conversation.conversationId, following: true }).select('actor_tenant', 'actor_user_id');
  const addAssignment = async (tenant: string, assignment: { assigned_to?: string; assigned_team_id?: string } | undefined) => {
    if (!assignment) return;
    if (assignment.assigned_to) candidates.push({ actor_tenant: tenant, actor_user_id: assignment.assigned_to });
    if (assignment.assigned_team_id) for (const row of await tenantDb(db, tenant).table('team_members').where('team_id', assignment.assigned_team_id).select('user_id'))
      candidates.push({ actor_tenant: tenant, actor_user_id: row.user_id });
  };
  if (source.conversation.storeTenant === source.ticket.tenant) await addAssignment(source.ticket.tenant,
    await owner.table('tickets').where('ticket_id', source.ticket.ticketId).first('assigned_to', 'assigned_team_id'));
  const relations = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at')
    .modify(query => { if (source.ticket.relationshipId) query.where('relationship_id', source.ticket.relationshipId);
      if (source.conversation.storeTenant !== source.ticket.tenant) query.where('sponsor_tenant', source.conversation.storeTenant); })
    .select('relationship_id', 'sponsor_tenant');
  for (const relation of relations) await addAssignment(relation.sponsor_tenant,
    await tenantDb(db, relation.sponsor_tenant).table('co_managed_ticket_references').where({ customer_tenant: source.ticket.tenant,
      relationship_id: relation.relationship_id, ticket_id: source.ticket.ticketId }).first('assigned_to', 'assigned_team_id'));
  const unique = new Map(candidates.map(row => [`${row.actor_tenant}:${row.actor_user_id}`, { kind: 'notification_recipient' as const, tenant: row.actor_tenant, userId: row.actor_user_id }]));
  return [...unique.values()].sort((a, b) => a.tenant.localeCompare(b.tenant) || a.userId.localeCompare(b.userId));
}

export function namedConversationNotificationKey(source: NamedConversationNotificationSource, actor: { tenant: string; userId: string }) {
  return `named-conversation:${source.conversation.storeTenant}:${source.conversation.conversationId}:${source.commentId}:${source.sequence}:${actor.tenant}:${actor.userId}`;
}
