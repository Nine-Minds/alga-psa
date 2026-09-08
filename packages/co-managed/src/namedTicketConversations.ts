import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState, isCoManagedLifecycleError } from '@alga-psa/licensing';
import { resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  type ConversationTicketReference, type TicketConversationReference, type CreateTicketConversation,
  type ConversationStoreScope, type NamedTicketConversation, TicketConversationError,
  snapshotConversationTicket, snapshotConversationReference, snapshotCreateConversation,
  ensureDefaultTicketConversation, listStoredTicketConversations, readStoredTicketConversation,
  createStoredTicketConversation, setStoredConversationStatus,
} from '@alga-psa/shared/lib/tickets/namedConversations';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  authorizeCoManagedWorkRecord, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources } from './conversationPolicy';
import { readConversationEditorDraft, saveConversationEditorDraft, snapshotConversationDraftParent, type ConversationDraftParent, type EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { readAuthorizedTicketConversationPage, snapshotConversationCursor, type CoManagedConversationCursor } from './ticketConversation';
import { ensureCoManagedActorReference } from './actorReferences';
import { mutateCoManagedPrivateTicketComment } from './privateTicketConversation';
import type { CoManagedCommentInsert } from './ticketCommentCreation';
import { conversationUuid } from '@alga-psa/shared/lib/tickets/namedConversations';
import { encodeConversationContent, snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';

interface ConversationAuthority {
  trx: Knex.Transaction;
  actor: CoManagedSessionActor;
  ticket: ConversationTicketReference;
  shared: boolean;
  sharedContext?: CoManagedSharedWorkContext;
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
        const result = await work({ trx: read.trx, actor, ticket, shared: true, sharedContext: context, hidden: [...context.redactedFields, ...read.redactedFields] });
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

/** A reply target is qualified by its already authorized destination, never by
 * a comment ID alone. Run for draft updates and again at publication. */
async function assertConversationReplyParent(context: ConversationAuthority, conversation: NamedTicketConversation, parent: ConversationDraftParent) {
  const privateStore = conversation.storeTenant !== context.ticket.tenant;
  const store = tenantDb(context.trx, conversation.storeTenant);
  const root = await store.table(privateStore ? 'co_management_private_threads' : 'comment_threads')
    .where({ thread_id: parent.threadId, conversation_id: conversation.conversationId }).forUpdate().first();
  if (!root || (privateStore && root.disclosure_operation_id)) return forbidden();
  const rows = await store.table(privateStore ? 'co_management_private_comments' : 'comments')
    .where('thread_id', parent.threadId).whereIn('comment_id', [root.root_comment_id, parent.commentId]).forShare();
  if (!rows.some(row => row.comment_id === root.root_comment_id) || !rows.some(row => row.comment_id === parent.commentId) ||
      rows.some(row => row.deleted_at || (!privateStore && (row.publish_state !== 'published' || row.is_internal !== (conversation.audience !== 'requester'))))) return forbidden();
  if (!privateStore && resolveCommentAudience(root) !== conversation.audience) return forbidden();
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
/** Selection is authorized before reading; the query constrains roots before its
 * page limit so busy sibling conversations cannot hide or leak selected messages. */
export function getNamedTicketConversationMessages(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, before?: CoManagedConversationCursor) {
  const reference = snapshotConversationReference(input), cursor = snapshotConversationCursor(before);
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    const page = await readAuthorizedTicketConversationPage({ trx: context.trx, actor: context.actor,
      sessionId: context.actor.sessionId, resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId,
        relationshipId: context.ticket.relationshipId }, redactedFields: context.hidden }, cursor, conversation);
    return { conversation, ...page };
  });
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
  if (!inputRequest || Object.keys(inputRequest).some(k => !['operationId', 'expectedRevision', 'expectedConversationRevision', 'content', 'parent'].includes(k))) {
    throw new TicketConversationError('CONVERSATION_INVALID');
  }
  const parent = snapshotConversationDraftParent(inputRequest.parent);
  if (inputRequest.content === null && parent) throw new TicketConversationError('CONVERSATION_INVALID');
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
    expectedConversationRevision: inputRequest.expectedConversationRevision, content,
    ...(inputRequest.parent !== undefined ? { parent } : {}) };
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    if (parent) await assertConversationReplyParent(context, conversation, parent);
    return saveConversationEditorDraft(draftStore(context, reference, conversation.revision), request);
  });
}


export interface NamedConversationPostRequest {
  operationId: string;
  expectedConversationRevision: number;
  expectedDraftRevision: number;
  parent?: { threadId: string; commentId: string };
}
export interface NamedConversationPostContext extends ConversationAuthority {
  conversation: NamedTicketConversation;
  actorReferenceId?: string;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
/** Explicit internal Post consumes exactly the reviewed author-private draft.
 * Email transport requires its separate envelope/send admission. */
export function postNamedTicketConversationDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, inputRequest: NamedConversationPostRequest,
  apply: (context: NamedConversationPostContext, comment: CoManagedCommentInsert) => Promise<void>) {
  const reference = snapshotConversationReference(input);
  if (!inputRequest || !conversationUuid(inputRequest.operationId) ||
      !Number.isSafeInteger(inputRequest.expectedConversationRevision) || inputRequest.expectedConversationRevision < 1 ||
      !Number.isSafeInteger(inputRequest.expectedDraftRevision) || inputRequest.expectedDraftRevision < 1 ||
      Object.keys(inputRequest).some(k => !['operationId', 'expectedConversationRevision', 'expectedDraftRevision', 'parent'].includes(k)) ||
      (inputRequest.parent && (!conversationUuid(inputRequest.parent.threadId) || !conversationUuid(inputRequest.parent.commentId) ||
        Object.keys(inputRequest.parent).some(k => !['threadId', 'commentId'].includes(k))))) throw new TicketConversationError('CONVERSATION_INVALID');
  const request: NamedConversationPostRequest = { operationId: inputRequest.operationId.toLowerCase(),
    expectedConversationRevision: inputRequest.expectedConversationRevision, expectedDraftRevision: inputRequest.expectedDraftRevision,
    ...(inputRequest.parent ? { parent: { threadId: inputRequest.parent.threadId.toLowerCase(), commentId: inputRequest.parent.commentId.toLowerCase() } } : {}) };
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    const { trx } = context, store = tenantDb(trx, reference.storeTenant), home = tenantDb(trx, context.actor.tenant);
    const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: context.actor.tenant, userId: context.actor.userId },
      ticket: context.ticket, reference, request, mode: 'post' })).digest('hex');
    const receipt = (row: any) => ({ ...reference, operationId: row.operation_id, threadId: row.thread_id, commentId: row.comment_id });
    const previous = await store.table('ticket_conversation_publications').where('operation_id', request.operationId).forShare().first();
    if (previous) {
      if (previous.request_hash !== hash) throw new TicketConversationError('CONVERSATION_CONFLICT');
      return receipt(previous);
    }
    if (conversation.transport !== 'internal' || conversation.audience === 'requester') throw new TicketConversationError('CONVERSATION_INVALID');
    if (conversation.revision !== request.expectedConversationRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
    const draftScope = draftStore(context, reference, conversation.revision);
    const draft = await home.table('ticket_conversation_editor_drafts').where({ actor_user_id: context.actor.userId,
      conversation_store_tenant: reference.storeTenant, conversation_id: reference.conversationId,
      ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId }).forUpdate().first();
    if (!draft || draft.revision !== request.expectedDraftRevision || draft.conversation_revision !== conversation.revision) throw new TicketConversationError('CONVERSATION_CONFLICT');
    if (!draft.content || !Array.isArray(draft.attachment_manifest) || draft.attachment_manifest.length) throw new TicketConversationError('CONVERSATION_INVALID');
    let content: CoManagedConversationContent;
    try { content = snapshotConversationContent(draft.content); } catch { throw new TicketConversationError('CONVERSATION_INVALID'); }
    const privateStore = reference.storeTenant !== context.ticket.tenant;
    const parent = draft.reply_comment_id ? { threadId: draft.reply_thread_id, commentId: draft.reply_comment_id } : null;
    if (request.parent && (request.parent.threadId !== parent?.threadId || request.parent.commentId !== parent?.commentId))
      throw new TicketConversationError('CONVERSATION_CONFLICT');
    const threadId = parent?.threadId ?? request.operationId;
    if (parent) await assertConversationReplyParent(context, conversation, parent);
    if (privateStore) {
      await mutateCoManagedPrivateTicketComment(trx, context.actor,
        { kind: 'ticket', tenant: context.ticket.tenant, id: context.ticket.ticketId, relationshipId: context.ticket.relationshipId! },
        { kind: 'create', operationId: request.operationId, ...content,
          ...(parent ? { parent: { storeTenant: reference.storeTenant, ...parent } } : {}) },
        { conversationId: reference.conversationId });
    } else {
      const actorReferenceId = context.actor.tenant !== context.ticket.tenant
        ? await ensureCoManagedActorReference(context.sharedContext!) : undefined;
      const assertWriteAuthority = async (current: Knex.Transaction) => {
        if (current !== trx) return forbidden();
        await assertCoManagedSessionUnexpired(trx, context.actor);
        await assertCoManagedOperationalWrite(trx, context.ticket.tenant);
      };
      await apply({ ...context, conversation, actorReferenceId, assertWriteAuthority }, {
        comment_id: request.operationId, ticket_id: context.ticket.ticketId, thread_id: threadId,
        parent_comment_id: parent?.commentId ?? null, ...encodeConversationContent(content), is_internal: true,
        is_resolution: false, author_type: 'internal', user_id: actorReferenceId ? null : context.actor.userId, publish_state: 'published',
      });
    }
    await store.table('ticket_conversations').where('conversation_id', reference.conversationId)
      .increment('message_version', 1).update({ updated_at: trx.fn.now() });
    await saveConversationEditorDraft(draftScope, { operationId: request.operationId, expectedRevision: draft.revision,
      expectedConversationRevision: conversation.revision, content: null });
    const [saved] = await store.table('ticket_conversation_publications').insert({ tenant: reference.storeTenant,
      operation_id: request.operationId, conversation_id: reference.conversationId, ticket_tenant: context.ticket.tenant,
      ticket_id: context.ticket.ticketId, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId,
      request_hash: hash, mode: 'post', thread_id: threadId, comment_id: request.operationId }).returning('*');
    return receipt(saved);
  });
}


/** Presentation hints only. Every draft, create and post command reauthorizes. */
export async function getNamedTicketConversationWriteAudiences(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference): Promise<CommentAudience[]> {
  try { return await withTicketAuthority(db, actor, ticket, 'update', async context => [...new Set(stores(context).flatMap(entry => entry.audiences))]); }
  catch (error) {
    if (error instanceof TicketConversationError || error instanceof CoManagedSharedWorkError || isCoManagedLifecycleError(error)) return [];
    throw error;
  }
}
