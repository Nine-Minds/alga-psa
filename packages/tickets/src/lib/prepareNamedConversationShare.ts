import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { readNamedConversationShareSource, retainNamedConversationShareDraft, prepareNamedConversationShareFiles,
  assertNamedConversationShareFiles, type NamedConversationShareProvenance, type NamedConversationFileStorage,
  withNamedTicketConversation, getNamedConversationEditorDraft, saveNamedConversationEditorDraft, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { snapshotConversationEditorFiles, type ConversationEditorFileReference } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';
import { snapshotConversationEmailDraft, reviewConversationEmailDraft, type ConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { snapshotCoManagedSessionActor } from '@alga-psa/co-managed';
import { extractTicketRichTextPlainText } from './ticketRichText';
import { namedConversationFileStorage } from './conversationFileStorage';

export interface NamedConversationShareRequest {
  operationId: string;
  source: TicketConversationReference;
  commentId: string;
  threadId: string;
  expectedDraftRevision: number;
  expectedConversationRevision: number;
  replaceExisting: boolean;
  quote: boolean;
  attachments?: ConversationEditorFileReference[];
  email?: ConversationEmailDraft;
}
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
type Source = Awaited<ReturnType<typeof readNamedConversationShareSource>>;
type State = { context: Context; source: Source; current: any; completed: boolean };
function draftQuery(context: Context) {
  // LEVERAGE: pattern qualified-editor-draft-scope — publication and transformation adapters repeat the engine's private draft lookup.
  return tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_editor_drafts').where({
    actor_user_id: context.actor.userId, conversation_store_tenant: context.conversation.storeTenant, conversation_id: context.conversation.conversationId,
    ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId });
}
function sourceSnapshot(message: Source['message']) {
  return digest({ note: message.note, markdown: message.markdown, revision: message.revision, updatedAt: message.updatedAt });
}

/** Copy currently authorized text and only explicitly selected files into this
 * author's private draft. Source/destination grants and revision intent are
 * retained independently for staging and final CAS; preparation never publishes. */
export async function prepareNamedConversationShare(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  destination: TicketConversationReference, input: NamedConversationShareRequest, storage: NamedConversationFileStorage = namedConversationFileStorage) {
  if (db.isTransaction || !input || Object.keys(input).some(key => !['operationId', 'source', 'commentId', 'threadId',
    'expectedDraftRevision', 'expectedConversationRevision', 'replaceExisting', 'quote', 'attachments', 'email'].includes(key)) ||
    ![input.operationId, input.commentId, input.threadId].every(conversationUuid) ||
    !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 0 ||
    !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 ||
    typeof input.replaceExisting !== 'boolean' || typeof input.quote !== 'boolean') return invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket);
  const source = snapshotConversationReference(input.source), ref = snapshotConversationReference(destination);
  const attachments = snapshotConversationEditorFiles(input.attachments ?? []);
  const email = snapshotConversationEmailDraft(input.email);
  if (email) reviewConversationEmailDraft(email, []);
  const request = { operationId: input.operationId.toLowerCase(), source,
    commentId: input.commentId.toLowerCase(), threadId: input.threadId.toLowerCase(),
    expectedDraftRevision: input.expectedDraftRevision, expectedConversationRevision: input.expectedConversationRevision,
    replaceExisting: input.replaceExisting, quote: input.quote, attachments, ...(email ? { email } : {}) };
  const sourceRef = { ...source, commentId: request.commentId, threadId: request.threadId };
  const requestHash = digest({ destination: ref, ...request });
  const withState = <T>(work: (state: State) => Promise<T>) => withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    if (email && context.conversation.transport !== 'email') return invalid();
    if (context.conversation.revision !== request.expectedConversationRevision) return conflict();
    const selected = await readNamedConversationShareSource(context, sourceRef);
    // Apply draft-field redactions before inspecting even an existing revision.
    await getNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref);
    const current = await draftQuery(context).forUpdate().first();
    const completed = current?.provenance?.kind === 'message_share' && current.provenance.operationId === request.operationId;
    if (completed) {
      if (current.provenance.requestHash !== requestHash) return conflict();
    } else if ((current?.revision ?? 0) !== request.expectedDraftRevision ||
      (current?.content != null && !request.replaceExisting)) return conflict();
    return work({ context, source: selected, current, completed });
  });
  const completedDraft = (state: State) => getNamedConversationEditorDraft(state.context.trx, state.context.actor, state.context.ticket, ref);
  const initial = await withState(async state => state.completed
    ? { completed: true as const, draft: await completedDraft(state) }
    : { completed: false as const, snapshot: sourceSnapshot(state.source.message) });
  if (initial.completed) return initial.draft;
  const unchanged = (state: State) => {
    if (state.completed || sourceSnapshot(state.source.message) !== initial.snapshot) return conflict();
  };
  try {
    const copies = await prepareNamedConversationShareFiles(db, request.operationId, sourceRef, attachments.map(file => file.attachmentId),
      work => withState(async state => {
        unchanged(state);
        return work({ ...state.context, sourceConversation: state.source.conversation });
      }), storage);
    return await withState(async state => {
      if (state.completed) return completedDraft(state);
      unchanged(state);
      const { context, source: { message, conversation: sourceConversation } } = state;
      await assertNamedConversationShareFiles({ ...context, sourceConversation }, sourceRef, copies);
      const text = extractTicketRichTextPlainText(message.note);
      const content = request.quote && text.trim() ? { document: [{ type: 'quote', content: [{ type: 'text', text, styles: {} }] }] } : { text };
      // Reset inherited delivery and business-state intent. The destination
      // composer establishes its reviewed envelope and any new publication options.
      const draft = await saveNamedConversationEditorDraft(context.trx, context.actor, context.ticket, ref, {
        operationId: request.operationId, expectedRevision: request.expectedDraftRevision,
        expectedConversationRevision: request.expectedConversationRevision, content,
        attachments: copies.map(file => ({ attachmentId: file.editorAttachmentId })), email, parent: null, publicationOptions: null,
      });
      const provenance: NamedConversationShareProvenance = { kind: 'message_share', operationId: request.operationId, requestHash,
        source: { ...sourceRef, revision: message.revision, updatedAt: message.updatedAt, snapshot: initial.snapshot },
        quote: request.quote, attachments: copies };
      await retainNamedConversationShareDraft(context, provenance);
      await draftQuery(context).update({ provenance: JSON.stringify(provenance) });
      return draft;
    });
  } catch (error) {
    // Another exact retry may have completed preparation between transfer phases.
    // Return its current edited draft; never overwrite it with the old snapshot.
    if (!(error instanceof TicketConversationError && error.code === 'CONVERSATION_CONFLICT')) throw error;
    return withState(async state => { if (!state.completed) throw error; return completedDraft(state); });
  }
}
