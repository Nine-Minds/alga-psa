import { tenantDb } from '@alga-psa/db';
import { conversationUuid, TicketConversationError, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { ConversationAiSnapshot } from '@alga-psa/shared/lib/tickets/conversationAi';
import type { NamedConversationPolicyContext } from './namedTicketConversations';
import { listPublishedCoManagedAttachments } from './conversationAttachments';
import { namedConversationMessageFileContext } from './namedConversationAttachments';
import { readNamedConversationShareSource } from './namedConversationShares';

type Context = NamedConversationPolicyContext & { conversation: NamedTicketConversation };
const denied = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
function query(context: Context, operationId: string) {
  return tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_ai_runs').where({ operation_id: operationId,
    actor_user_id: context.actor.userId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    relationship_id: context.ticket.relationshipId ?? null, destination_store_tenant: context.conversation.storeTenant,
    destination_conversation_id: context.conversation.conversationId, kind: 'synthesis', status: 'completed' });
}
async function assertSources(context: Context, snapshot: Omit<ConversationAiSnapshot, 'input'>) {
  if (!snapshot || !Array.isArray(snapshot.sources) || snapshot.sources.length !== 1 || snapshot.request?.kind !== 'synthesis') return denied();
  for (const source of snapshot.sources) {
    if (!Array.isArray(source.messages) || !source.messages.length) return denied();
    for (const message of source.messages) {
      const { conversation } = await readNamedConversationShareSource(context, { ...source.reference, commentId: message.commentId, threadId: message.threadId });
      if (!Array.isArray(message.attachmentIds)) return denied();
      if (message.attachmentIds.length) {
        // The model saw file metadata even though synthesis copies no bytes.
        // Recheck that grant before publishing text derived from that metadata.
        const files = await listPublishedCoManagedAttachments(await namedConversationMessageFileContext({ ...context, conversation }, message.commentId, message.threadId));
        const available = new Set(files.map(file => file.attachmentId));
        if (message.attachmentIds.some(id => !available.has(id))) return denied();
      }
    }
  }
}
export async function retainNamedConversationSynthesisPublication(context: Context, draft: any, published: { commentId: string; threadId: string }) {
  if (draft.provenance?.kind !== 'conversation_synthesis') return;
  const provenance = draft.provenance;
  if (!conversationUuid(provenance.operationId)) return conflict();
  const row = await query(context, provenance.operationId).forUpdate().first();
  if (!row || row.request_hash !== provenance.requestHash || row.published_comment_id || row.prepared_draft_revision > draft.revision) return conflict();
  await assertSources(context, row.source_snapshot);
  await query(context, provenance.operationId).update({ published_comment_id: published.commentId, published_thread_id: published.threadId, updated_at: context.trx.fn.now() });
  return provenance.operationId as string;
}
/** Generation and scheduled publication are separate authority boundaries. A
 * reviewed, already published copy subsequently follows its own destination. */
export async function assertScheduledConversationSynthesisSource(context: Context, publication: any) {
  if (!publication.ai_run_operation_id) return;
  if (publication.actor_tenant !== context.actor.tenant || publication.actor_user_id !== context.actor.userId) return denied();
  const row = await query(context, publication.ai_run_operation_id).where({ published_comment_id: publication.comment_id,
    published_thread_id: publication.thread_id }).forShare().first();
  if (!row) return denied();
  await assertSources(context, row.source_snapshot);
}
