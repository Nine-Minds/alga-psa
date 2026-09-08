import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { authorizedConversation, withNamedTicketConversation, getNamedConversationEditorDraft,
  saveNamedConversationEditorDraft, readAuthorizedTicketConversationMessage, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { conversationUuid, snapshotConversationReference, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { extractTicketRichTextPlainText } from './ticketRichText';

export interface NamedConversationShareRequest {
  operationId: string;
  source: TicketConversationReference;
  commentId: string;
  threadId: string;
  expectedDraftRevision: number;
  expectedConversationRevision: number;
  replaceExisting: boolean;
  quote: boolean;
}
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const forbidden = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Prepare a text copy only; publication remains the existing reviewed Send/Post.
 * No browser body, source title, storage path or claimed provenance is accepted.
 * Selected-file preparation is a separate extension of this command, not implicit
 * copying of images/attachments found in the source's document. */
export function prepareNamedConversationShare(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, input: NamedConversationShareRequest) {
  if (!input || Object.keys(input).some(key => !['operationId', 'source', 'commentId', 'threadId',
    'expectedDraftRevision', 'expectedConversationRevision', 'replaceExisting', 'quote'].includes(key)) ||
    ![input.operationId, input.commentId, input.threadId].every(conversationUuid) ||
    !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 0 ||
    !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 ||
    typeof input.replaceExisting !== 'boolean' || typeof input.quote !== 'boolean') return invalid();
  const source = snapshotConversationReference(input.source), ref = snapshotConversationReference(destination);
  const request: NamedConversationShareRequest = { operationId: input.operationId.toLowerCase(), source,
    commentId: input.commentId.toLowerCase(), threadId: input.threadId.toLowerCase(),
    expectedDraftRevision: input.expectedDraftRevision, expectedConversationRevision: input.expectedConversationRevision,
    replaceExisting: input.replaceExisting, quote: input.quote };
  const requestHash = digest({ destination: ref, ...request });
  return withNamedTicketConversation(db, actor, ticket, ref, 'read', async context => {
    const { conversation } = await authorizedConversation(context, source);
    if (context.conversation.revision !== request.expectedConversationRevision) return conflict();
    const owner = tenantDb(context.trx, conversation.storeTenant), privateStore = conversation.storeTenant !== context.ticket.tenant;
    // Retain the source version through the copy, including the root's audience
    // and publication state. A surviving published reply below a deleted root
    // can still be shared as text; files have their stricter independent gate.
    const thread = await owner.table(privateStore ? 'co_management_private_threads' : 'comment_threads')
      .where({ thread_id: request.threadId, conversation_id: source.conversationId }).forShare().first('root_comment_id');
    if (!thread) return forbidden();
    await owner.table(privateStore ? 'co_management_private_comments' : 'comments').where('thread_id', request.threadId)
      .whereIn('comment_id', [...new Set([thread.root_comment_id, request.commentId])]).forShare().select('comment_id');
    const message = await readAuthorizedTicketConversationMessage({ trx: context.trx, actor: context.actor,
      resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId, relationshipId: context.ticket.relationshipId },
      redactedFields: context.hidden }, conversation, request);
    if (!message || message.deleted || message.note === null) return forbidden();

    // Apply draft-field redactions before inspecting even an existing revision.
    await getNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref);
    // LEVERAGE: pattern qualified-editor-draft-scope — publication and transformation adapters repeat the engine's private draft lookup.
    const drafts = () => tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_editor_drafts').where({
      actor_user_id: context.actor.userId, conversation_store_tenant: ref.storeTenant, conversation_id: ref.conversationId,
      ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId });
    const current = await drafts().forUpdate().first();
    if (current?.provenance?.kind === 'message_share' && current.provenance.operationId === request.operationId) {
      if (current.provenance.requestHash !== requestHash) return conflict();
      // An uncertain preparation retry returns the current edited draft. It
      // never re-copies a subsequently edited source over the author's work.
      return getNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref);
    }
    if ((current?.revision ?? 0) !== request.expectedDraftRevision ||
      (current?.content !== null && current?.content !== undefined && !request.replaceExisting)) return conflict();
    const text = extractTicketRichTextPlainText(message.note);
    const content = request.quote && text.trim() ? { document: [{ type: 'quote', content: [{ type: 'text', text, styles: {} }] }] } : { text };
    // The ordinary command supplies update/RBAC, draft masks and bounded content
    // admission in this same transaction. Existing email, files, parent, close,
    // resolution and scheduling intent are deliberately reset on replacement.
    const draft = await saveNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref, {
      operationId: request.operationId, expectedRevision: request.expectedDraftRevision,
      expectedConversationRevision: request.expectedConversationRevision, content, attachments: [], email: null,
      parent: null, publicationOptions: null,
    });
    await drafts().update({ provenance: JSON.stringify({ kind: 'message_share', operationId: request.operationId, requestHash,
      source: { ...source, commentId: request.commentId, threadId: request.threadId,
        revision: message.revision, updatedAt: message.updatedAt,
        snapshot: digest({ note: message.note, markdown: message.markdown, revision: message.revision, updatedAt: message.updatedAt }) },
      quote: request.quote, attachments: [],
    }) });
    return draft;
  });
}
