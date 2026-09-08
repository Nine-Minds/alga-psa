import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { withNamedTicketConversation } from './namedTicketConversations';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { hasCoManagedLocalPermission } from './localPermission';
import { conversationUuid, TicketConversationError, type ConversationTicketReference, type TicketConversationReference, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';

export interface ConversationMailbox { tenant: string; id: string; email: string; name: string | null }
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
const forbidden = () => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const invalid = () => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const conflict = () => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
function reference(conversation: NamedTicketConversation) { return { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }; }
async function mailboxOwner(context: Context): Promise<string> {
  const { conversation, trx, ticket } = context;
  if (isCoManagedReadFieldHidden(context.hidden, ['mailbox', 'mailbox_id', 'mailbox_tenant', 'email_providers', 'ticket_conversation_sender_grants'])) return forbidden();
  if (conversation.transport !== 'email') return invalid();
  if (conversation.audience === 'requester') return ticket.tenant;
  if (conversation.mailbox) return conversation.mailbox.tenant;
  const row = await tenantDb(trx, conversation.storeTenant).table('ticket_conversations').where('conversation_id', conversation.conversationId).first('created_by_tenant');
  if (!row?.created_by_tenant) return forbidden();
  return row.created_by_tenant;
}
function grants(context: Context, owner: string, mailboxId?: string) {
  return tenantDb(context.trx, owner).table('ticket_conversation_sender_grants').where({
    conversation_store_tenant: context.conversation.storeTenant, conversation_id: context.conversation.conversationId,
    ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, relationship_id: context.ticket.relationshipId,
  }).modify(query => { if (mailboxId) query.where('mailbox_id', mailboxId); });
}
async function authorizeMailbox(context: Context, owner: string, mailboxId: string): Promise<ConversationMailbox> {
  await assertCoManagedOperationalWrite(context.trx, owner);
  if (context.actor.tenant !== owner) {
    if (!context.ticket.relationshipId || !await grants(context, owner, mailboxId)
      .where({ grantee_tenant: context.actor.tenant, grantee_user_id: context.actor.userId }).forShare().first()) return forbidden();
  }
  const row = await tenantDb(context.trx, owner).table('email_providers').where({ id: mailboxId, is_active: true, status: 'connected' })
    .forShare().first('id', 'mailbox', 'sender_display_name');
  if (!row || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(row.mailbox) || /[\r\n\0]/.test(row.sender_display_name ?? '')) return forbidden();
  return { tenant: owner, id: row.id, email: row.mailbox, name: row.sender_display_name || null };
}
/** Options convey send capability only. Reading Shared IT never lends the
 * other organization's connected mailbox or credentials. */
export function listNamedConversationMailboxes(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference) {
  return withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    const owner = await mailboxOwner(context);
    await assertCoManagedOperationalWrite(context.trx, owner);
    const rows = await tenantDb(context.trx, owner).table('email_providers').where({ is_active: true, status: 'connected' }).select('id');
    const allowed = context.actor.tenant === owner ? null : context.ticket.relationshipId
      ? new Set((await grants(context, owner).where({ grantee_tenant: context.actor.tenant, grantee_user_id: context.actor.userId }).select('mailbox_id')).map(row => row.mailbox_id)) : new Set();
    const result: ConversationMailbox[] = [];
    for (const row of rows) if (!allowed || allowed.has(row.id)) result.push(await authorizeMailbox(context, owner, row.id));
    return result;
  });
}
export function selectNamedConversationMailbox(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference,
  expectedRevision: number, mailboxId: string) {
  if (!conversationUuid(mailboxId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  mailboxId = mailboxId.toLowerCase();
  return withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    if (context.conversation.revision !== expectedRevision) return conflict();
    const owner = await mailboxOwner(context), mailbox = await authorizeMailbox(context, owner, mailboxId);
    if (context.conversation.mailbox?.id === mailbox.id && context.conversation.mailbox.tenant === owner) return context.conversation;
    await tenantDb(context.trx, context.conversation.storeTenant).table('ticket_conversations').where('conversation_id', context.conversation.conversationId)
      .update({ mailbox_tenant: owner, mailbox_id: mailbox.id, revision: expectedRevision + 1, updated_at: context.trx.fn.now() });
    return { ...context.conversation, mailbox: { tenant: owner, id: mailbox.id }, revision: expectedRevision + 1 };
  });
}
/** The transport adapter executes only while resource, sender grant and mailbox
 * rows remain admitted. Call separately again when delivering queued intent. */
export function withNamedConversationMailbox<T>(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference,
  expectedRevision: number, work: (context: Context, mailbox: ConversationMailbox) => Promise<T>) {
  return withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    if (context.conversation.revision !== expectedRevision) return conflict();
    const owner = await mailboxOwner(context);
    if (!context.conversation.mailbox || context.conversation.mailbox.tenant !== owner) return forbidden();
    return work(context, await authorizeMailbox(context, owner, context.conversation.mailbox.id));
  });
}
/** Narrow per-conversation delegation. The mailbox owner's policy administrator
 * may grant sending to an internal user in the participating organization. */
export function setNamedConversationSenderGrant(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, ref: TicketConversationReference,
  request: { expectedRevision: number; granteeTenant: string; granteeUserId: string; enabled: boolean }) {
  if (!request || !conversationUuid(request.granteeTenant) || !conversationUuid(request.granteeUserId) || typeof request.enabled !== 'boolean' ||
      !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1 ||
      Object.keys(request).some(key => !['expectedRevision', 'granteeTenant', 'granteeUserId', 'enabled'].includes(key))) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  const input = { ...request, granteeTenant: request.granteeTenant.toLowerCase(), granteeUserId: request.granteeUserId.toLowerCase() };
  return withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    const owner = await mailboxOwner(context), selected = context.conversation.mailbox;
    if (context.conversation.revision !== input.expectedRevision) return conflict();
    if (context.actor.tenant !== owner || !selected || !context.ticket.relationshipId ||
        !await hasCoManagedLocalPermission(context.trx, context.actor, 'co_management', 'manage', true)) return forbidden();
    const relation = await tenantDb(context.trx, context.ticket.tenant).table('co_management_relationships')
      .where('relationship_id', context.ticket.relationshipId).forShare().first('sponsor_tenant');
    if (!relation || input.granteeTenant === owner || ![relation.sponsor_tenant, context.ticket.tenant].includes(input.granteeTenant)) return forbidden();
    if (input.enabled) {
      await authorizeMailbox(context, owner, selected.id);
      const user = await tenantDb(context.trx, input.granteeTenant).table('users')
        .where({ user_id: input.granteeUserId, user_type: 'internal', is_inactive: false }).forShare().first('user_id');
      if (!user) return forbidden();
      await grants(context, owner, selected.id).insert({ tenant: owner, mailbox_id: selected.id,
        conversation_store_tenant: context.conversation.storeTenant, conversation_id: context.conversation.conversationId,
        ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, relationship_id: context.ticket.relationshipId,
        grantee_tenant: input.granteeTenant, grantee_user_id: input.granteeUserId, granted_by_user_id: context.actor.userId }).onConflict().ignore();
    } else await grants(context, owner, selected.id).where({ grantee_tenant: input.granteeTenant, grantee_user_id: input.granteeUserId }).del();
    await tenantDb(context.trx, context.conversation.storeTenant).table('ticket_conversations').where('conversation_id', reference(context.conversation).conversationId)
      .update({ revision: context.conversation.revision + 1, updated_at: context.trx.fn.now() });
    return { ...context.conversation, revision: context.conversation.revision + 1 };
  });
}
