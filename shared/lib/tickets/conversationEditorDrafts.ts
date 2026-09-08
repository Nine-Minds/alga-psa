import { createHash } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { TicketConversationError, conversationUuid, snapshotConversationReference, snapshotConversationTicket,
  type ConversationTicketReference, type TicketConversationReference } from './namedConversations';

export interface ConversationEditorDraft<Content = unknown> {
  content: Content | null;
  parent: ConversationDraftParent | null;
  revision: number;
  conversationRevision: number;
  updatedAt: string;
}
export interface ConversationDraftParent { threadId: string; commentId: string }
export function snapshotConversationDraftParent(value: unknown): ConversationDraftParent | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !['threadId', 'commentId'].includes(k))) throw new TicketConversationError('CONVERSATION_INVALID');
  const parent = value as ConversationDraftParent;
  if (!conversationUuid(parent.threadId) || !conversationUuid(parent.commentId)) throw new TicketConversationError('CONVERSATION_INVALID');
  return { threadId: parent.threadId.toLowerCase(), commentId: parent.commentId.toLowerCase() };
}
export interface EditorDraftSaveRequest<Content = unknown> {
  operationId: string;
  expectedRevision: number;
  expectedConversationRevision: number;
  content: Content | null;
  parent?: ConversationDraftParent | null;
}
export interface EditorDraftStoreScope {
  trx: Knex.Transaction;
  actor: { tenant: string; userId: string };
  ticket: ConversationTicketReference;
  conversation: TicketConversationReference;
  conversationRevision: number;
}
function scoped(scope: EditorDraftStoreScope) {
  if (!scope.trx.isTransaction || ![scope.actor.tenant, scope.actor.userId].every(conversationUuid)) throw new TicketConversationError('CONVERSATION_INVALID');
  const ticket = snapshotConversationTicket(scope.ticket), ref = snapshotConversationReference(scope.conversation);
  return tenantDb(scope.trx, scope.actor.tenant).table('ticket_conversation_editor_drafts')
    .where({ actor_user_id: scope.actor.userId, conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId,
      ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId });
}
function view<Content>(row: any): ConversationEditorDraft<Content> {
  return { content: row.content, parent: row.reply_comment_id ? { threadId: row.reply_thread_id, commentId: row.reply_comment_id } : null,
    revision: row.revision, conversationRevision: row.conversation_revision, updatedAt: new Date(row.updated_at).toISOString() };
}
/** Called after current destination read authorization. The author is always
 * supplied by authentication; no browser parameter selects someone else's draft. */
export async function readConversationEditorDraft<Content>(scope: EditorDraftStoreScope): Promise<ConversationEditorDraft<Content> | null> {
  const row = await scoped(scope).first();
  return row ? view<Content>(row) : null;
}
/** An immutable request snapshot is prepared by the content adapter before any
 * await. Empty/discarded drafts retain their revision so stale autosaves cannot
 * resurrect text or overwrite a later share/generation result. */
export async function saveConversationEditorDraft<Content>(scope: EditorDraftStoreScope,
  input: EditorDraftSaveRequest<Content>): Promise<ConversationEditorDraft<Content>> {
  if (!input || !conversationUuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 ||
      Object.keys(input).some(k => !['operationId', 'expectedRevision', 'expectedConversationRevision', 'content', 'parent'].includes(k))) throw new TicketConversationError('CONVERSATION_INVALID');
  const parent = snapshotConversationDraftParent(input.parent);
  if (input.content === null && parent) throw new TicketConversationError('CONVERSATION_INVALID');
  if (input.expectedConversationRevision !== scope.conversationRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
  const serialized = JSON.stringify(input);
  const request = JSON.parse(serialized) as EditorDraftSaveRequest<Content>;
  const hash = createHash('sha256').update(serialized).digest('hex');
  const query = () => scoped(scope);
  if (request.expectedRevision === 0) {
    await tenantDb(scope.trx, scope.actor.tenant).table('ticket_conversation_editor_drafts').insert({
      tenant: scope.actor.tenant, actor_user_id: scope.actor.userId, conversation_store_tenant: scope.conversation.storeTenant,
      conversation_id: scope.conversation.conversationId, ticket_tenant: scope.ticket.tenant, ticket_id: scope.ticket.ticketId,
      content: request.content === null ? null : JSON.stringify(request.content), revision: 1, conversation_revision: scope.conversationRevision,
      reply_thread_id: parent?.threadId ?? null, reply_comment_id: parent?.commentId ?? null,
      last_operation_id: request.operationId, last_request_hash: hash,
    }).onConflict(['tenant', 'actor_user_id', 'conversation_store_tenant', 'conversation_id']).ignore();
  }
  const current = await query().forUpdate().first();
  if (!current) throw new TicketConversationError('CONVERSATION_CONFLICT');
  if (current.last_operation_id === request.operationId) {
    if (current.last_request_hash !== hash) throw new TicketConversationError('CONVERSATION_CONFLICT');
    return view<Content>(current);
  }
  if (current.revision !== request.expectedRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
  const [row] = await query().update({ content: request.content === null ? null : JSON.stringify(request.content),
    reply_thread_id: parent?.threadId ?? null, reply_comment_id: parent?.commentId ?? null,
    revision: current.revision + 1, conversation_revision: scope.conversationRevision,
    last_operation_id: request.operationId, last_request_hash: hash, updated_at: scope.trx.fn.now() }).returning('*');
  return view<Content>(row);
}
