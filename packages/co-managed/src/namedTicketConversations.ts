import { snapshotRequesterPublicationOptions, type RequesterPublicationOptions } from '@alga-psa/shared/lib/tickets/requesterPublicationOptions';
import { snapshotConversationEditorFiles } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';
import { snapshotConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, isCoManagedLifecycleError } from '@alga-psa/licensing';
import { resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  type ConversationTicketReference, type TicketConversationReference, type CreateTicketConversation,
  type ConversationStoreScope, type NamedTicketConversation, TicketConversationError,
  snapshotConversationTicket, snapshotConversationReference, snapshotCreateConversation,
  ensureDefaultTicketConversation, listStoredTicketConversations, readStoredTicketConversation,
  createStoredTicketConversation, setStoredConversationStatus, conversationUuid,
} from '@alga-psa/shared/lib/tickets/namedConversations';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationAttachmentSources, coManagedConversationBodySources } from './conversationPolicy';
import { readConversationEditorDraft, saveConversationEditorDraft, snapshotConversationDraftParent, type ConversationDraftParent, type EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { readAuthorizedTicketConversationPage, readAuthorizedTicketConversationMessage, snapshotConversationCursor, type CoManagedConversationCursor, type CoManagedConversationItem } from './ticketConversation';
import { ensureCoManagedActorReference } from './actorReferences';
import { mutateCoManagedPrivateTicketComment } from './privateTicketConversation';
import type { CoManagedCommentInsert } from './ticketCommentCreation';
import { encodeConversationContent, snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeNativeTicketConversation } from './nativeConversationAuthority';
import type { CoManagedHomeActor } from './policy';

interface ConversationAuthority {
  trx: Knex.Transaction;
  actor: CoManagedSessionActor;
  ticket: ConversationTicketReference;
  shared: boolean;
  sharedContext?: CoManagedSharedWorkContext;
  hidden: readonly string[];
}
export type NamedConversationPolicyContext = Omit<ConversationAuthority, 'actor'> & { actor: CoManagedHomeActor };
const fields = [...coManagedConversationBodySources, 'ticket_conversations', 'conversation_id', 'name', 'audience', 'default_slot', 'message_version', 'mailbox_id', 'mailbox_tenant'];
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
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    const context = await authorizeNativeTicketConversation(trx, actor, subject, ticket, action);
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work(context);
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}
function stores(context: NamedConversationPolicyContext): { scope: ConversationStoreScope; audiences: CommentAudience[] }[] {
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
export async function authorizedConversation(context: NamedConversationPolicyContext, reference: TicketConversationReference, write = false) {
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

async function listAuthorizedConversations(context: ConversationAuthority): Promise<NamedTicketConversation[]> {
  const entries = stores(context), rows: NamedTicketConversation[] = [];
  for (const entry of entries) {
    // Read-authorized initialization creates only a system default container;
    // it does not publish content, notify, or grant permission to create sides.
    if (entry.scope.storeTenant === context.ticket.tenant && entry.audiences.includes('requester')) await ensureDefaultTicketConversation(entry.scope, 'requester');
    rows.push(...await listStoredTicketConversations(entry.scope, entry.audiences));
  }
  return rows.sort((a, b) => Number(b.defaultSlot === 'requester') - Number(a.defaultSlot === 'requester') || a.createdAt.localeCompare(b.createdAt) || a.conversationId.localeCompare(b.conversationId));
}
export function listNamedTicketConversations(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference): Promise<NamedTicketConversation[]> {
  return withTicketAuthority(db, actor, ticket, 'read', listAuthorizedConversations);
}
/** Navigator metadata shares the current qualified ticket admission. Private
 * source proofs are applied before any per-viewer count leaves its store. */
export function listNamedTicketConversationOverview(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference) {
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const conversations = await listAuthorizedConversations(context);
    const { readNamedConversationAttention } = await import('./namedConversationAttention');
    const rows: Array<NamedTicketConversation & { attention: Awaited<ReturnType<typeof readNamedConversationAttention>> }> = [];
    for (const candidate of conversations) {
      const { conversation } = await authorizedConversation(context, candidate);
      rows.push({ ...conversation, attention: await readNamedConversationAttention({ ...context, conversation }) });
    }
    return rows;
  });
}
export function getNamedTicketConversation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference) {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'read', async context => (await authorizedConversation(context, reference)).conversation);
}
export function getNamedTicketConversationReplyTarget(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, parent: ConversationDraftParent) {
  const reference = snapshotConversationReference(input), selected = snapshotConversationDraftParent(parent);
  if (!selected) return Promise.reject(new TicketConversationError('CONVERSATION_INVALID'));
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    await assertConversationReplyParent(context, conversation, selected);
    return selected;
  });
}
/** Selection is authorized before reading; the query constrains roots before its
 * page limit so busy sibling conversations cannot hide or leak selected messages. */
export function getNamedTicketConversationMessages(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, before?: CoManagedConversationCursor, messageId?: string) {
  const reference = snapshotConversationReference(input), cursor = snapshotConversationCursor(before);
  if (cursor && messageId !== undefined) throw new TicketConversationError('CONVERSATION_INVALID');
  return withTicketAuthority(db, actor, ticket, 'read', context => messageId === undefined
    ? readAuthorizedConversationMessages(context, reference, cursor) : readConversationMessagePage(context, reference, messageId));
}
async function readAuthorizedConversationMessages(context: ConversationAuthority, reference: TicketConversationReference, cursor?: CoManagedConversationCursor) {
  const { conversation } = await authorizedConversation(context, reference);
  const page = await readAuthorizedTicketConversationPage({ trx: context.trx, actor: context.actor,
    sessionId: context.actor.sessionId, resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId,
      relationshipId: context.ticket.relationshipId }, redactedFields: context.hidden }, cursor, conversation);
  await decorateConversationMessages(context, conversation, page.items);
  return { conversation, ...page };
}

async function decorateConversationMessages(context: ConversationAuthority, conversation: NamedTicketConversation, items: CoManagedConversationItem[]) {
  if (conversation.transport === 'email') {
    const { attachPublishedConversationEmails } = await import('./conversationEmailOperations');
    await attachPublishedConversationEmails({ ...context, conversation }, items);
  }
  const { attachNamedConversationFiles } = await import('./namedConversationAttachments');
  await attachNamedConversationFiles({ ...context, conversation }, items);
  const { attachNamedConversationShareLinks } = await import('./namedConversationShares');
  await attachNamedConversationShareLinks({ ...context, conversation }, items);
}

/** Jump directly to a message without scanning every newer page. Permission,
 * audience and publication filtering use the same projection as normal history.
 * Missing, deleted and foreign targets return the same opaque result within an
 * independently authorized conversation; they never change its destination. */
async function readConversationMessagePage(context: ConversationAuthority, reference: TicketConversationReference, messageId: string) {
  const { conversation } = await authorizedConversation(context, reference);
  const unavailable = async () => ({ ...await readAuthorizedConversationMessages(context, reference), messageUnavailable: true as const });
  if (!conversationUuid(messageId)) return unavailable();
  messageId = messageId.toLowerCase();
  const source = await tenantDb(context.trx, conversation.storeTenant)
    .table(conversation.storeTenant === context.ticket.tenant ? 'comments' : 'co_management_private_comments')
    .where('comment_id', messageId).first('thread_id');
  if (!source?.thread_id) return unavailable();
  const item = await readAuthorizedTicketConversationMessage({ trx: context.trx, actor: context.actor,
    resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId, relationshipId: context.ticket.relationshipId }, redactedFields: context.hidden },
    conversation, { commentId: messageId, threadId: source.thread_id });
  if (!item || item.deleted) return unavailable();
  const previous = await readAuthorizedConversationMessages(context, reference,
    { createdAt: item.createdAt, storeTenant: item.storeTenant, commentId: item.commentId });
  await decorateConversationMessages(context, conversation, [item]);
  const items = [item, ...previous.items].slice(0, 25), last = items.at(-1)!;
  const nextBefore = previous.items.length >= 25 ? { createdAt: last.createdAt, storeTenant: last.storeTenant, commentId: last.commentId } : previous.nextBefore;
  return { conversation, items, nextBefore, focusedMessageId: item.commentId };
}
/** Merge bounded pages within one current ticket admission. Each source retains
 * its own audience lock, file admission and email redactions. The global cursor
 * has the same exact timestamp/store/comment order as the underlying reader. */
export function getNamedTicketConversationActivity(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, before?: CoManagedConversationCursor) {
  const cursor = snapshotConversationCursor(before);
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const conversations = await listAuthorizedConversations(context);
    const items: Array<import('./ticketConversation').CoManagedConversationItem & { conversation: NamedTicketConversation }> = [];
    let more = false;
    for (const conversation of conversations) {
      const page = await readAuthorizedConversationMessages(context, conversation, cursor);
      items.push(...page.items.map(item => ({ ...item, conversation: page.conversation })));
      more ||= page.nextBefore !== null;
    }
    // All timestamps are the reader's fixed UTC representation with microseconds.
    const compare = (a: string, b: string) => a === b ? 0 : a > b ? -1 : 1;
    items.sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.storeTenant, b.storeTenant) || compare(a.commentId, b.commentId));
    more ||= items.length > 25;
    const selected = items.slice(0, 25), last = selected.at(-1);
    return { items: selected, nextBefore: more && last ? { createdAt: last.createdAt, storeTenant: last.storeTenant, commentId: last.commentId } : null };
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
function canMarkRequesterResolution(context: ConversationAuthority, conversation: NamedTicketConversation) {
  return !context.shared && context.actor.tenant === context.ticket.tenant && conversation.audience === 'requester' && conversation.transport === 'email' &&
    !isCoManagedReadFieldHidden(context.hidden, ['is_resolution', 'resolution', 'comments.is_resolution', 'comments.resolution']);
}
export function canScheduleRequester(context: NamedConversationPolicyContext, conversation: NamedTicketConversation) {
  return !context.shared && context.actor.tenant === context.ticket.tenant && conversation.audience === 'requester' && conversation.transport === 'email' &&
    !isCoManagedReadFieldHidden(context.hidden, ['publish_state', 'scheduled_publish_at', 'scheduled_publish_tz',
      'comments.publish_state', 'comments.scheduled_publish_at', 'comments.scheduled_publish_tz']);
}
function canCloseRequesterResolution(context: ConversationAuthority, conversation: NamedTicketConversation) {
  return canMarkRequesterResolution(context, conversation) && !isCoManagedReadFieldHidden(context.hidden,
    ['status_id', 'status_name', 'statuses', 'board_id', 'is_closed', 'closed_at', 'closed_by', 'updated_by',
      'tickets.status_id', 'tickets.status_name', 'tickets.board_id', 'tickets.is_closed', 'tickets.closed_at', 'tickets.closed_by', 'tickets.updated_by']);
}
export async function admitNamedRequesterPublicationOptions(context: ConversationAuthority, conversation: NamedTicketConversation, input: unknown) {
  const options = snapshotRequesterPublicationOptions(input);
  if (options?.isResolution && !canMarkRequesterResolution(context, conversation)) return forbidden();
  if (options?.schedule) {
    if (!canScheduleRequester(context, conversation)) return forbidden();
    const due = await context.trx.raw('SELECT ?::timestamptz > clock_timestamp() AS future', [options.schedule.at]);
    if (!due.rows[0]?.future) throw new TicketConversationError('CONVERSATION_INVALID');
  }
  if (options?.close) {
    if (!canCloseRequesterResolution(context, conversation)) return forbidden();
    const store = tenantDb(context.trx, context.ticket.tenant);
    const ticket = await store.table('tickets').where('ticket_id', context.ticket.ticketId).first('board_id', 'master_ticket_id');
    if (!ticket || ticket.master_ticket_id || !await store.table('statuses').where({ status_id: options.close.statusId,
      board_id: ticket.board_id, is_closed: true, item_type: 'ticket' }).forShare().first()) return forbidden();
    if (options.close.overrideReason !== undefined && !await hasCoManagedLocalPermission(context.trx, context.actor, 'ticket', 'close_override', true)) return forbidden();
  }
  return options;
}
export function getNamedTicketConversationPublicationCapabilities(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference) {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    const resolution = canMarkRequesterResolution(context, conversation), scheduling = canScheduleRequester(context, conversation);
    if (!canCloseRequesterResolution(context, conversation)) return { resolution, scheduling };
    const store = tenantDb(context.trx, context.ticket.tenant);
    const row = await store.table('tickets').where('ticket_id', context.ticket.ticketId).first('board_id', 'master_ticket_id');
    if (!row || row.master_ticket_id) return { resolution, scheduling };
    const statuses = await store.table('statuses').where({ board_id: row.board_id, is_closed: true, item_type: 'ticket' })
      .orderBy('order_number').select('status_id', 'name');
    return { resolution, scheduling, closeStatuses: statuses.map(status => ({ value: status.status_id as string, label: status.name as string })),
      canOverrideClose: await hasCoManagedLocalPermission(context.trx, context.actor, 'ticket', 'close_override') };
  });
}

/** A native bundle is not authority for its other tickets. Named publication
 * must admit each target under the author's current home identity and masks. */
export function assertNamedTicketConversationBundleTarget(db: Knex, actor: CoManagedSessionActor,
  ticket: ConversationTicketReference, effect: 'mirror' | 'reopen' | 'close') {
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    if (context.shared) return forbidden();
    destinationScope(context, 'requester');
    const affected = effect !== 'mirror'
      ? ['status_id', 'is_closed', 'closed_at', 'closed_by', 'updated_by', 'updated_at']
      : ['comments', 'comment_threads', 'is_resolution', 'comments.is_resolution', 'is_system_generated'];
    if (isCoManagedReadFieldHidden(context.hidden, affected.flatMap(field => [field, `tickets.${field}`]))) return forbidden();
  });
}
export function getNamedConversationEditorDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference, input: TicketConversationReference) {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, 'read', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    const draft = await readConversationEditorDraft<CoManagedConversationContent>(draftStore(context, reference, conversation.revision));
    if (!draft) return draft;
    return { ...draft, ...(draft.publicationOptions && ((draft.publicationOptions.isResolution && !canMarkRequesterResolution(context, conversation)) ||
      (draft.publicationOptions.schedule && !canScheduleRequester(context, conversation)) ||
      (draft.publicationOptions.close && !canCloseRequesterResolution(context, conversation))) ? { publicationOptions: null } : {}),
      ...(isCoManagedReadFieldHidden(context.hidden, coManagedConversationAttachmentSources) ? { attachments: [] } : {}) };
  });
}
export function saveNamedConversationEditorDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, inputRequest: EditorDraftSaveRequest<CoManagedConversationContent>) {
  const reference = snapshotConversationReference(input);
  if (!inputRequest || Object.keys(inputRequest).some(k => !['operationId', 'expectedRevision', 'expectedConversationRevision', 'content', 'parent', 'email', 'attachments', 'publicationOptions'].includes(k))) {
    throw new TicketConversationError('CONVERSATION_INVALID');
  }
  const attachments = inputRequest.attachments === undefined ? undefined : snapshotConversationEditorFiles(inputRequest.attachments);
  const parent = snapshotConversationDraftParent(inputRequest.parent);
  const email = snapshotConversationEmailDraft(inputRequest.email);
  const publicationOptions = snapshotRequesterPublicationOptions(inputRequest.publicationOptions);
  if (inputRequest.content === null && (parent || email || attachments?.length || publicationOptions)) throw new TicketConversationError('CONVERSATION_INVALID');
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
    ...(attachments !== undefined ? { attachments } : {}),
    ...(inputRequest.publicationOptions !== undefined ? { publicationOptions } : {}),
    ...(inputRequest.parent !== undefined ? { parent } : {}), ...(inputRequest.email !== undefined ? { email } : {}) };
  return withTicketAuthority(db, actor, ticket, 'update', async context => {
    const { conversation } = await authorizedConversation(context, reference);
    if (email && conversation.transport !== 'email') throw new TicketConversationError('CONVERSATION_INVALID');
    if (parent) await assertConversationReplyParent(context, conversation, parent);
    const scope = draftStore(context, reference, conversation.revision);
    const retained = request.content !== null && request.publicationOptions === undefined ? (await readConversationEditorDraft(scope))?.publicationOptions : publicationOptions;
    await admitNamedRequesterPublicationOptions(context, conversation, retained);
    if (isCoManagedReadFieldHidden(context.hidden, coManagedConversationAttachmentSources) &&
      (attachments?.length || (await readConversationEditorDraft(scope))?.attachments.length)) return forbidden();
    return saveConversationEditorDraft(scope, request);
  });
}


export interface NamedConversationPostRequest {
  operationId: string;
  expectedConversationRevision: number;
  expectedDraftRevision: number;
  parent?: { threadId: string; commentId: string };
}
export interface NamedConversationPostContext extends ConversationAuthority {
  publicationOptions?: RequesterPublicationOptions | null;
  canUpdateResponseState: boolean;
  conversation: NamedTicketConversation;
  actorReferenceId?: string;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
/** Explicit internal Post consumes exactly the reviewed author-private draft.
 * Email transport requires its separate envelope/send admission. */
function publishNamedTicketConversationDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, inputRequest: NamedConversationPostRequest,
  apply: (context: NamedConversationPostContext, comment: CoManagedCommentInsert) => Promise<void>, mode: 'post' | 'send') {
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
    const { namedConversationPublicationHash, assertNamedConversationPublicationFiles } = await import('./namedConversationPublicationFiles');
    const hash = namedConversationPublicationHash(context.actor, context.ticket, reference, request, mode);
    const receipt = (row: any) => ({ ...reference, operationId: row.operation_id, threadId: row.thread_id, commentId: row.comment_id });
    const previous = await store.table('ticket_conversation_publications').where('operation_id', request.operationId).forShare().first();
    if (previous) {
      if (previous.request_hash !== hash) throw new TicketConversationError('CONVERSATION_CONFLICT');
      return receipt(previous);
    }
    if (conversation.transport !== (mode === 'post' ? 'internal' : 'email') || (mode === 'post' && conversation.audience === 'requester')) throw new TicketConversationError('CONVERSATION_INVALID');
    if (conversation.revision !== request.expectedConversationRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
    const draftScope = draftStore(context, reference, conversation.revision);
    const draft = await home.table('ticket_conversation_editor_drafts').where({ actor_user_id: context.actor.userId,
      conversation_store_tenant: reference.storeTenant, conversation_id: reference.conversationId,
      ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId }).forUpdate().first();
    if (!draft || draft.revision !== request.expectedDraftRevision || draft.conversation_revision !== conversation.revision) throw new TicketConversationError('CONVERSATION_CONFLICT');
    const publicationOptions = await admitNamedRequesterPublicationOptions(context, conversation, draft.publication_options);
    if (!draft.content || !Array.isArray(draft.attachment_manifest)) throw new TicketConversationError('CONVERSATION_INVALID');
    let content: CoManagedConversationContent;
    try { content = snapshotConversationContent(draft.content); } catch { throw new TicketConversationError('CONVERSATION_INVALID'); }
    const privateStore = reference.storeTenant !== context.ticket.tenant;
    const parent = draft.reply_comment_id ? { threadId: draft.reply_thread_id, commentId: draft.reply_comment_id } : null;
    if (request.parent && (request.parent.threadId !== parent?.threadId || request.parent.commentId !== parent?.commentId))
      throw new TicketConversationError('CONVERSATION_CONFLICT');
    const threadId = parent?.threadId ?? request.operationId;
    if (parent) await assertConversationReplyParent(context, conversation, parent);
    await assertNamedConversationPublicationFiles({ ...context, conversation, scope: { trx, ticket: context.ticket, storeTenant: reference.storeTenant } }, draft, request, mode);
    const { retainNamedConversationSharePublication } = await import('./namedConversationShares');
    const { retainNamedConversationSynthesisPublication } = await import('./conversationSynthesisPublication');
    const aiRunOperationId = await retainNamedConversationSynthesisPublication({ ...context, conversation }, draft, { commentId: request.operationId, threadId });
    const shareOperationId = aiRunOperationId ? undefined : await retainNamedConversationSharePublication({ ...context, conversation }, draft, { commentId: request.operationId, threadId });
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
      await apply({ ...context, conversation, actorReferenceId, assertWriteAuthority, publicationOptions,
        canUpdateResponseState: !isCoManagedReadFieldHidden(context.hidden, ['response_state', 'tickets.response_state']) }, {
        comment_id: request.operationId, ticket_id: context.ticket.ticketId, thread_id: threadId,
        parent_comment_id: parent?.commentId ?? null, ...encodeConversationContent(content), is_internal: conversation.audience !== 'requester',
        is_resolution: false, author_type: 'internal', user_id: actorReferenceId ? null : context.actor.userId, publish_state: 'published',
      });
    }
    if (!publicationOptions?.schedule) {
      const { recordNamedConversationAttention } = await import('./namedConversationAttention');
      await recordNamedConversationAttention({ ...context, conversation }, { commentId: request.operationId, threadId });
      await store.table('ticket_conversations').where('conversation_id', reference.conversationId)
        .increment('message_version', 1).update({ updated_at: trx.fn.now() });
    }
    await saveConversationEditorDraft(draftScope, { operationId: request.operationId, expectedRevision: draft.revision,
      expectedConversationRevision: conversation.revision, content: null });
    const [saved] = await store.table('ticket_conversation_publications').insert({ tenant: reference.storeTenant,
      operation_id: request.operationId, conversation_id: reference.conversationId, ticket_tenant: context.ticket.tenant,
      ticket_id: context.ticket.ticketId, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId,
      publication_options: publicationOptions ? JSON.stringify(publicationOptions) : null,
      request_hash: hash, mode, thread_id: threadId, comment_id: request.operationId, share_operation_id: shareOperationId ?? null,
      ai_run_operation_id: aiRunOperationId ?? null }).returning('*');
    return receipt(saved);
  });
}

export function postNamedTicketConversationDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, request: NamedConversationPostRequest,
  apply: (context: NamedConversationPostContext, comment: CoManagedCommentInsert) => Promise<void>) {
  return publishNamedTicketConversationDraft(db, actor, ticket, input, request, apply, 'post');
}
/** Internal publication adapter for an explicitly reviewed vendor Send. The
 * owning email operation retains review/envelope intent in the same transaction. */
export async function sendNamedTicketConversationDraft(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, request: NamedConversationPostRequest,
  apply: (context: NamedConversationPostContext, comment: CoManagedCommentInsert) => Promise<void>) {
  const stableActor = snapshotCoManagedSessionActor(actor), stableTicket = snapshotConversationTicket(ticket), stableRef = snapshotConversationReference(input);
  const stableRequest = { ...request, ...(request.parent ? { parent: { ...request.parent } } : {}) };
  const { withNamedConversationMailbox } = await import('./conversationMailboxes');
  return withNamedConversationMailbox(db, stableActor, stableTicket, stableRef, stableRequest.expectedConversationRevision,
    context => publishNamedTicketConversationDraft(context.trx, context.actor, context.ticket,
      { storeTenant: context.conversation.storeTenant, conversationId: context.conversation.conversationId }, stableRequest, apply, 'send'));
}


/** Presentation hints only. Every draft, create and post command reauthorizes. */
export async function getNamedTicketConversationWriteAudiences(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference): Promise<CommentAudience[]> {
  try { return await withTicketAuthority(db, actor, ticket, 'update', async context => [...new Set(stores(context).flatMap(entry => entry.audiences))]); }
  catch (error) {
    if (error instanceof TicketConversationError || error instanceof CoManagedSharedWorkError || isCoManagedLifecycleError(error)) return [];
    throw error;
  }
}

/** Extension point for conversation operations with retained resource, audience
 * and session authority. Adapters cannot select a store before this admission. */
export function withNamedTicketConversation<T>(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  input: TicketConversationReference, action: 'read' | 'update',
  work: (context: ConversationAuthority & { scope: ConversationStoreScope; conversation: NamedTicketConversation }) => Promise<T>): Promise<T> {
  const reference = snapshotConversationReference(input);
  return withTicketAuthority(db, actor, ticket, action, async context => {
    const selected = await authorizedConversation(context, reference, action === 'update');
    return work({ ...context, ...selected });
  });
}
