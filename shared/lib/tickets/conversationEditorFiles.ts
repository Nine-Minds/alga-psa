import { tenantDb } from '@alga-psa/db';
import type { EditorDraftStoreScope } from './conversationEditorDrafts';
import { conversationUuid, TicketConversationError } from './namedConversations';

export interface ConversationEditorFileReference { attachmentId: string }
export interface ConversationEditorFile extends ConversationEditorFileReference {
  fileName: string; mimeType: string; size: number; contentHash: string;
}
export function snapshotConversationEditorFiles(value: unknown): ConversationEditorFileReference[] {
  if (!Array.isArray(value) || value.length > 20) throw new TicketConversationError('CONVERSATION_INVALID');
  const result = value.map(file => {
    if (!file || typeof file !== 'object' || Object.keys(file).some(k => k !== 'attachmentId') || !conversationUuid(file.attachmentId))
      throw new TicketConversationError('CONVERSATION_INVALID');
    return { attachmentId: file.attachmentId.toLowerCase() };
  });
  if (new Set(result.map(f => f.attachmentId)).size !== result.length) throw new TicketConversationError('CONVERSATION_INVALID');
  return result;
}
/** Only an admitted author/destination scope may select these unpublished files.
 * Ready upload metadata is immutable; a browser never supplies its digest/name. */
export function conversationEditorFileQuery(scope: EditorDraftStoreScope) {
  if (!scope.trx.isTransaction) throw new TicketConversationError('CONVERSATION_INVALID');
  return tenantDb(scope.trx, scope.actor.tenant).table('co_management_conversation_attachments').where({
    actor_tenant: scope.actor.tenant, actor_user_id: scope.actor.userId,
    customer_tenant: scope.ticket.tenant, ticket_id: scope.ticket.ticketId,
    named_editor_store_tenant: scope.conversation.storeTenant, named_editor_conversation_id: scope.conversation.conversationId,
  }).modify(q => scope.ticket.relationshipId ? q.where('relationship_id', scope.ticket.relationshipId) : q.whereNull('relationship_id'))
    .whereNull('comment_id').whereNull('thread_id').whereNull('draft_operation_id').whereNull('external_author_email')
    .whereNull('discarded_at').whereNull('purged_at');
}
export function conversationEditorFileView(row: any): ConversationEditorFile {
  return { attachmentId: row.attachment_id, fileName: row.file_name, mimeType: row.mime_type, size: row.file_size, contentHash: row.content_hash };
}
export async function selectConversationEditorFiles(scope: EditorDraftStoreScope, files: ConversationEditorFileReference[]): Promise<ConversationEditorFile[]> {
  if (!files.length) return [];
  const rows = await conversationEditorFileQuery(scope).where('status', 'ready').whereIn('attachment_id', files.map(f => f.attachmentId)).forShare();
  if (rows.length !== files.length) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const selected = files.map(f => conversationEditorFileView(rows.find(row => row.attachment_id === f.attachmentId)));
  if (selected.reduce((sum, f) => sum + f.size, 0) > 26214400) throw new TicketConversationError('CONVERSATION_INVALID');
  return selected;
}
