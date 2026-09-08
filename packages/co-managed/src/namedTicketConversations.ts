import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import { type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  type ConversationTicketReference, type TicketConversationReference, type CreateTicketConversation,
  type ConversationStoreScope, type NamedTicketConversation, TicketConversationError,
  snapshotConversationTicket, snapshotConversationReference, snapshotCreateConversation,
  ensureDefaultTicketConversation, listStoredTicketConversations, readStoredTicketConversation,
  createStoredTicketConversation, setStoredConversationStatus,
} from '@alga-psa/shared/lib/tickets/namedConversations';
import { withCoManagedSharedWork, type CoManagedSharedResource } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  authorizeCoManagedWorkRecord, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources } from './conversationPolicy';
import { readConversationEditorDraft, saveConversationEditorDraft, type EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';

interface ConversationAuthority {
  trx: Knex.Transaction;
  actor: CoManagedSessionActor;
  ticket: ConversationTicketReference;
  shared: boolean;
  hidden: readonly string[];
}
const fields = [...coManagedConversationBodySources, 'ticket_conversations', 'conversation_id', 'name', 'audience', 'default_slot', 'message_version'];
const forbidden = () => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };

/** Native and shared ticket entry points retain the actor's real home session.
 * Native PSA work has no co-managed relationship or entitlement prerequisite. */
async function withTicketAuthority<T>(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  action: 'read' | 'update', work: (context: ConversationAuthority) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket);
  actor.tenant = actor.tenant.toLowerCase(); actor.userId = actor.userId.toLowerCase(); actor.sessionId = actor.sessionId.toLowerCase();
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, ticket.tenant);
    const workspace = await owner.table('tenants').first('product_code', 'suspended_at');
    if (!workspace || workspace.suspended_at) return forbidden();
    if (actor.tenant !== ticket.tenant || workspace.product_code === 'co_managed') {
      if (!ticket.relationshipId && actor.tenant === ticket.tenant) {
        const relationship = await owner.table('co_management_relationships').where('state', 'active').whereNull('ended_at').first('relationship_id');
        if (relationship) ticket.relationshipId = relationship.relationship_id;
      }
      if (!ticket.relationshipId) return forbidden();
      const resource: CoManagedSharedResource = { kind: 'ticket', tenant: ticket.tenant, id: ticket.ticketId, relationshipId: ticket.relationshipId };
      const authorize = actor.tenant === ticket.tenant ? withCoManagedCustomerTicket : withCoManagedSharedWork;
      return authorize(trx, actor, resource, action, context => authorize(context.trx, actor, resource, 'read', async read => {
        const result = await work({ trx: read.trx, actor, ticket, shared: true, hidden: [...context.redactedFields, ...read.redactedFields] });
        await assertCoManagedSessionUnexpired(read.trx, actor);
        return result;
      }));
    }
    if (ticket.relationshipId || actor.tenant !== ticket.tenant) return forbidden();
    if (action === 'update') await assertCoManagedOperationalWrite(trx, ticket.tenant);
    else await getCoManagedOperationalState(trx, ticket.tenant);
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    const query = owner.table('tickets').where('ticket_id', ticket.ticketId);
    if (action === 'update') query.forUpdate(); else query.forShare();
    const row = await query.first('ticket_id', 'client_id', 'board_id', 'entered_by', 'assigned_to', 'assigned_team_id');
    if (!row) return forbidden();
    const record = { id: row.ticket_id, clientId: row.client_id, boardId: row.board_id, ownerUserId: row.entered_by,
      assignedUserIds: row.assigned_to ? [row.assigned_to] : [], teamIds: row.assigned_team_id ? [row.assigned_team_id] : [] };
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
    const read = action === 'read' ? decision : await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', 'read', record);
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work({ trx, actor, ticket, shared: false, hidden: [...decision.redactedFields, ...read.redactedFields] });
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}
function stores(context: ConversationAuthority): { scope: ConversationStoreScope; audiences: CommentAudience[] }[] {
  const { trx, actor, ticket, hidden } = context;
  const foreign = actor.tenant !== ticket.tenant;
  const result: { scope: ConversationStoreScope; audiences: CommentAudience[] }[] = [];
  if (!isCoManagedReadFieldHidden([...hidden], [...fields, 'comments', 'comment_threads'])) {
    result.push({ scope: { trx, ticket, storeTenant: ticket.tenant }, audiences: foreign
      ? ['requester', 'shared_it'] : ['requester', ...(context.shared ? ['shared_it' as const] : []), 'organization_private'] });
  }
  if (foreign && !isCoManagedReadFieldHidden([...hidden], [...fields, 'co_management_private_threads', 'co_management_private_comments'])) {
    result.push({ scope: { trx, ticket, storeTenant: actor.tenant }, audiences: ['organization_private'] });
  }
  return result;
}
function destinationScope(context: ConversationAuthority, audience: CommentAudience) {
  const tenant = audience === 'organization_private' ? context.actor.tenant : context.ticket.tenant;
  const entry = stores(context).find(s => s.scope.storeTenant === tenant && s.audiences.includes(audience));
  if (!entry) return forbidden();
  return entry.scope;
}
async function authorizedConversation(context: ConversationAuthority, reference: TicketConversationReference, write = false) {
  const entry = stores(context).find(s => s.scope.storeTenant === reference.storeTenant);
  if (!entry) return forbidden();
  const conversation = await readStoredTicketConversation(entry.scope, reference.conversationId, write ? 'update' : 'read');
  if (!entry.audiences.includes(conversation.audience)) return forbidden();
  return { scope: entry.scope, conversation };
}

export function listNamedTicketConversations(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference): Promise<NamedTicketConversation[]> {
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const entries = stores(context), rows: NamedTicketConversation[] = [];
    for (const entry of entries) {
      // Read-authorized initialization creates only a system default container;
      // it does not publish content, notify, or grant permission to create sides.
      if (entry.scope.storeTenant === context.ticket.tenant && entry.audiences.includes('requester')) await ensureDefaultTicketConversation(entry.scope, 'requester');
      rows.push(...await listStoredTicketConversations(entry.scope, entry.audiences));
    }
    return rows.sort((a, b) => Number(b.defaultSlot === 'requester') - Number(a.defaultSlot === 'requester') || a.createdAt.localeCompare(b.createdAt) || a.conversationId.localeCompare(b.conversationId));
  });
}
export function getNamedTicketConversation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference) {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'read', async context => (await authorizedConversation(context, reference)).conversation);
}
export function createNamedTicketConversation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: CreateTicketConversation) {
  const request = snapshotCreateConversation(input);
  return withTicketAuthority(db, actor, ticket, 'update', context => createStoredTicketConversation(destinationScope(context, request.audience), context.actor, request));
}
export function setNamedTicketConversationStatus(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, expectedRevision: number, status: 'open' | 'done') {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { scope } = await authorizedConversation(context, reference, true);
    return setStoredConversationStatus(scope, reference.conversationId, expectedRevision, status);
  });
}

function draftStore(context: ConversationAuthority, reference: TicketConversationReference, revision: number) {
  if (isCoManagedReadFieldHidden(context.hidden, ['drafts', 'content', 'ticket_conversation_editor_drafts'])) return forbidden();
  return { trx: context.trx, actor: context.actor, ticket: context.ticket, conversation: reference, conversationRevision: revision };
}
export function getNamedConversationEditorDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference) {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    return readConversationEditorDraft<CoManagedConversationContent>(draftStore(context, reference, conversation.revision));
  });
}
export function saveNamedConversationEditorDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, inputRequest: EditorDraftSaveRequest<CoManagedConversationContent>) {
  const reference = snapshotConversationReference(input);
  if (!inputRequest || Object.keys(inputRequest).some(k => !['operationId', 'expectedRevision', 'expectedConversationRevision', 'content'].includes(k))) {
    throw new TicketConversationError('CONVERSATION_INVALID');
  }
  let content: CoManagedConversationContent | null = null;
  if (inputRequest.content !== null) {
    const body = inputRequest.content;
    if (!body || Object.keys(body).some(k => !['text', 'document'].includes(k))) throw new TicketConversationError('CONVERSATION_INVALID');
    if (body.document === undefined && typeof body.text === 'string' && body.text.length <= 100000 && !body.text.includes('\0')) {
      content = { text: body.text }; // Empty in-progress text is valid; publication has stricter admission.
    } else {
      try { content = snapshotConversationContent(body); } catch { throw new TicketConversationError('CONVERSATION_INVALID'); }
    }
  }
  const request = { operationId: inputRequest.operationId, expectedRevision: inputRequest.expectedRevision,
    expectedConversationRevision: inputRequest.expectedConversationRevision, content };
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    return saveConversationEditorDraft(draftStore(context, reference, conversation.revision), request);
  });
}
