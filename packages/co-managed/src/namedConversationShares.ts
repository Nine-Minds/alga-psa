import { isDeepStrictEqual } from 'node:util';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { conversationUuid, snapshotConversationReference, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import { authorizedConversation, withNamedTicketConversation, type NamedConversationPolicyContext } from './namedTicketConversations';
import { readAuthorizedTicketConversationMessage } from './ticketConversation';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import type { CoManagedSessionActor } from './sharedWorkIdentity';

export interface NamedConversationShareSource extends TicketConversationReference { commentId: string; threadId: string }
export interface NamedConversationShareProvenance {
  kind: 'message_share'; operationId: string; requestHash: string;
  source: NamedConversationShareSource & { revision: number | null; updatedAt: string | null; snapshot: string };
  quote: boolean;
  attachments: Array<{ sourceAttachmentId: string; editorAttachmentId: string; contentHash: string }>;
}
const TABLE = 'ticket_conversation_shares';
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const forbidden = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
export const namedConversationShareSources = ['provenance', 'source', 'source_link', 'ticket_conversation_shares'];

/** Retained current read authority for a text snapshot or its protected source
 * link. Files deliberately use their independent, stricter root/file gate. */
export async function readNamedConversationShareSource(context: NamedConversationPolicyContext, input: NamedConversationShareSource) {
  if (!input || ![input.commentId, input.threadId].every(conversationUuid)) return forbidden();
  const ref = snapshotConversationReference({ storeTenant: input.storeTenant, conversationId: input.conversationId });
  const { conversation } = await authorizedConversation(context, ref);
  const owner = tenantDb(context.trx, ref.storeTenant), privateStore = ref.storeTenant !== context.ticket.tenant;
  const thread = await owner.table(privateStore ? 'co_management_private_threads' : 'comment_threads')
    .where({ thread_id: input.threadId, conversation_id: ref.conversationId }).forShare().first('root_comment_id');
  if (!thread) return forbidden();
  await owner.table(privateStore ? 'co_management_private_comments' : 'comments').where('thread_id', input.threadId)
    .whereIn('comment_id', [...new Set([thread.root_comment_id, input.commentId])]).forShare().select('comment_id');
  const message = await readAuthorizedTicketConversationMessage({ trx: context.trx, actor: context.actor,
    resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId, relationshipId: context.ticket.relationshipId },
    redactedFields: context.hidden }, conversation, input);
  if (!message || message.deleted || message.note === null) return forbidden();
  return { conversation, message };
}

type Context = NamedConversationPolicyContext & { conversation: NamedTicketConversation };
function binding(context: Context) {
  return { actor_user_id: context.actor.userId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    relationship_id: context.ticket.relationshipId ?? null, destination_store_tenant: context.conversation.storeTenant,
    destination_conversation_id: context.conversation.conversationId };
}
/** Internal receipt engine: the caller has admitted and snapshotted the source,
 * then saved this author's draft in the same transaction. No content is public. */
export async function retainNamedConversationShareDraft(context: Context, provenance: NamedConversationShareProvenance) {
  const values = { ...binding(context), request_hash: provenance.requestHash, source: provenance.source,
    quote: provenance.quote, attachment_manifest: provenance.attachments };
  const owner = tenantDb(context.trx, context.actor.tenant);
  await owner.table(TABLE).insert({ tenant: context.actor.tenant, operation_id: provenance.operationId, ...values,
    source: JSON.stringify(values.source), attachment_manifest: JSON.stringify(values.attachment_manifest) })
    .onConflict(['tenant', 'operation_id']).ignore();
  const retained = await owner.table(TABLE).where('operation_id', provenance.operationId).forUpdate().first();
  if (!retained || retained.published_comment_id || Object.entries(values).some(([key, value]) => !isDeepStrictEqual(retained[key], value))) return conflict();
}

/** Publication links the reviewed copy to the immutable private receipt before
 * consuming the draft. Current source access is still required at this point;
 * subsequent source edits/deletion never mutate the accepted destination copy. */
export async function retainNamedConversationSharePublication(context: Context, draft: any,
  published: { commentId: string; threadId: string }) {
  if (draft.provenance == null) return;
  const provenance = draft.provenance as NamedConversationShareProvenance;
  if (provenance.kind !== 'message_share' || !conversationUuid(provenance.operationId)) return conflict();
  const query = () => tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ operation_id: provenance.operationId, ...binding(context) });
  const retained = await query().forUpdate().first();
  if (!retained || retained.published_comment_id || retained.request_hash !== provenance.requestHash ||
    !isDeepStrictEqual(retained.source, provenance.source) || retained.quote !== provenance.quote ||
    !isDeepStrictEqual(retained.attachment_manifest, provenance.attachments)) return conflict();
  await readNamedConversationShareSource(context, provenance.source);
  const selected = new Set<string>(draft.attachment_manifest.map((file: { attachmentId: string }) => file.attachmentId));
  const publishedFiles = provenance.attachments.filter(file => selected.has(file.editorAttachmentId));
  if (publishedFiles.length) {
    const { namedConversationMessageFileContext } = await import('./namedConversationAttachments');
    const { assertPublishedCoManagedAttachmentFingerprint } = await import('./conversationAttachments');
    const { conversation } = await authorizedConversation(context, provenance.source);
    const selected = await namedConversationMessageFileContext({ ...context, conversation }, provenance.source.commentId, provenance.source.threadId);
    for (const file of publishedFiles) {
      await assertPublishedCoManagedAttachmentFingerprint(selected, file.sourceAttachmentId, file.contentHash);
      if (!draft.attachment_manifest.some((selected: { attachmentId: string; contentHash: string }) =>
        selected.attachmentId === file.editorAttachmentId && selected.contentHash === file.contentHash)) return conflict();
    }
  }
  await query().update({ published_comment_id: published.commentId, published_thread_id: published.threadId,
    published_editor_attachment_ids: JSON.stringify(publishedFiles.map(file => file.editorAttachmentId)), published_at: context.trx.fn.now() });
  return provenance.operationId;
}

/** A scheduled copy has not yet become a published snapshot. Its retained
 * native author/source authority must still hold when the schedule becomes due. */
export async function assertScheduledConversationShareSource(context: Context, publication: {
  share_operation_id?: string | null; actor_tenant: string; actor_user_id: string; comment_id: string; thread_id: string;
}) {
  if (!publication.share_operation_id) return;
  if (publication.actor_tenant !== context.actor.tenant || publication.actor_user_id !== context.actor.userId) return forbidden();
  const retained = await tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ ...binding(context),
    operation_id: publication.share_operation_id, published_comment_id: publication.comment_id, published_thread_id: publication.thread_id }).forShare().first();
  if (!retained) return forbidden();
  const { conversation } = await readNamedConversationShareSource(context, retained.source);
  const files = (retained.attachment_manifest as NamedConversationShareProvenance['attachments'])
    .filter(file => retained.published_editor_attachment_ids.includes(file.editorAttachmentId));
  if (!files.length) return;
  const { namedConversationMessageFileContext } = await import('./namedConversationAttachments');
  const { assertPublishedCoManagedAttachmentFingerprint } = await import('./conversationAttachments');
  const selected = await namedConversationMessageFileContext({ ...context, conversation }, retained.source.commentId, retained.source.threadId);
  for (const file of files) await assertPublishedCoManagedAttachmentFingerprint(selected, file.sourceAttachmentId, file.contentHash);
}

/** Technician-only projection. The accepted destination publication qualifies
 * the private receipt lookup; it cannot supply an arbitrary home-store query.
 * Neither this receipt nor a link grants read authority to the original source. */
export function getNamedConversationShareSourceLink(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, input: { commentId: string; threadId: string }) {
  if (!input || ![input.commentId, input.threadId].every(conversationUuid) ||
    Object.keys(input).some(key => !['commentId', 'threadId'].includes(key))) throw new TicketConversationError('CONVERSATION_INVALID');
  const selected = { commentId: input.commentId.toLowerCase(), threadId: input.threadId.toLowerCase() };
  return withNamedTicketConversation(db, actor, ticket, destination, 'read', async context => {
    if (isCoManagedReadFieldHidden(context.hidden, namedConversationShareSources)) return null;
    await readNamedConversationShareSource(context, { storeTenant: context.conversation.storeTenant,
      conversationId: context.conversation.conversationId, ...selected });
    const item = { ...selected, storeTenant: context.conversation.storeTenant, deleted: false };
    await attachNamedConversationShareLinks(context, [item]);
    return (item as { sharedFrom?: NamedConversationShareLink }).sharedFrom ?? null;
  });
}


export interface NamedConversationShareLink {
  conversation: TicketConversationReference & { name: string };
  commentId: string;
  threadId: string;
}

/** Only technician history readers call this projection. Accepted publications
 * qualify receipt ownership; source admission independently controls each link.
 * Fetch candidate publications as one page query, not one query per history row. */
export async function attachNamedConversationShareLinks(context: Context, items: Array<{
  commentId: string; threadId: string; storeTenant: string; deleted: boolean; sharedFrom?: NamedConversationShareLink;
}>) {
  for (const item of items) delete item.sharedFrom;
  if (isCoManagedReadFieldHidden(context.hidden, namedConversationShareSources)) return;
  const selected = items.filter(item => !item.deleted && item.storeTenant === context.conversation.storeTenant);
  if (!selected.length) return;
  const user = await tenantDb(context.trx, context.actor.tenant).table('users').where('user_id', context.actor.userId).first('user_type');
  if (user?.user_type !== 'internal') return;
  const publications = await tenantDb(context.trx, context.conversation.storeTenant).table('ticket_conversation_publications')
    .where({ conversation_id: context.conversation.conversationId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId })
    .whereNotNull('share_operation_id').whereIn(['comment_id', 'thread_id'], selected.map(item => [item.commentId, item.threadId]))
    .forShare().select('comment_id', 'thread_id', 'actor_tenant', 'actor_user_id', 'share_operation_id');
  for (const publication of publications) {
    const item = selected.find(item => item.commentId === publication.comment_id && item.threadId === publication.thread_id)!;
    try {
      await readNamedConversationShareSource(context, { storeTenant: context.conversation.storeTenant,
        conversationId: context.conversation.conversationId, commentId: item.commentId, threadId: item.threadId });
      const retained = await tenantDb(context.trx, publication.actor_tenant).table(TABLE).where({ operation_id: publication.share_operation_id,
        actor_user_id: publication.actor_user_id, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
        destination_store_tenant: context.conversation.storeTenant, destination_conversation_id: context.conversation.conversationId,
        published_comment_id: item.commentId, published_thread_id: item.threadId }).forShare().first('source');
      if (!retained) continue;
      const { conversation, message } = await readNamedConversationShareSource(context, retained.source);
      item.sharedFrom = { conversation: { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId, name: conversation.name },
        commentId: message.commentId, threadId: message.threadId };
    } catch (error) {
      if (!(error instanceof TicketConversationError && error.code === 'CONVERSATION_FORBIDDEN')) throw error;
    }
  }
}
