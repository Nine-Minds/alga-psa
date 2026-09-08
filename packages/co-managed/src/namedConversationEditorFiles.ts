import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { conversationEditorFileQuery, conversationEditorFileView, snapshotConversationEditorFiles } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';
import { snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { withNamedTicketConversation } from './namedTicketConversations';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { coManagedConversationAttachmentSources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { CoManagedAttachmentError, snapshotConversationFileBytes, transferProtectedConversationFile, type ConversationFileBytes } from './protectedConversationFileTransfer';
import { assertCoManagedAttachmentPath } from './attachmentStoragePath';

const deny = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
function editorScope(context: Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0]) {
  if (isCoManagedReadFieldHidden(context.hidden, ['drafts', 'content', 'ticket_conversation_editor_drafts', ...coManagedConversationAttachmentSources])) return deny();
  return { trx: context.trx, actor: context.actor, ticket: context.ticket, conversation: context.conversation, conversationRevision: context.conversation.revision };
}
/** The upload belongs to the authenticated author's home, even when the eventual
 * message will live in a customer-owned Shared IT conversation. Selection is a
 * separate draft CAS operation; uploading does not change or publish its text. */
export async function uploadNamedConversationEditorFile(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputConversation: TicketConversationReference, input: ConversationFileBytes,
  upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>) {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), ref = snapshotConversationReference(inputConversation);
  const file = snapshotConversationFileBytes(input);
  if (db.isTransaction || Object.keys(input).some(k => !['attachmentId', 'fileName', 'mimeType', 'content'].includes(k))) throw new CoManagedAttachmentError('INVALID_ATTACHMENT');
  const withAuthority = <T>(work: (context: ReturnType<typeof editorScope> & { assertWriteAuthority: () => Promise<void> }) => Promise<T>) =>
    withNamedTicketConversation(db, actor, ticket, ref, 'update', context => {
      const scope = editorScope(context);
      return work({ ...scope, assertWriteAuthority: async () => {
        await assertCoManagedSessionUnexpired(scope.trx, scope.actor);
        await assertCoManagedOperationalWrite(scope.trx, scope.ticket.tenant);
      } });
    });
  const binding = await withAuthority(async context => ({ tenant: context.actor.tenant, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId,
    customer_tenant: context.ticket.tenant, relationship_id: context.ticket.relationshipId ?? null, ticket_id: context.ticket.ticketId,
    named_editor_store_tenant: ref.storeTenant, named_editor_conversation_id: ref.conversationId,
    comment_id: null, thread_id: null, draft_operation_id: null, external_author_email: null }));
  const hash = createHash('sha256').update(JSON.stringify({ binding, attachmentId: file.attachmentId, fileName: file.fileName,
    mimeType: file.mimeType, contentHash: file.contentHash, size: file.content.length })).digest('hex');
  return transferProtectedConversationFile(db, file, binding, hash, work => withAuthority(context => {
    if (context.actor.tenant !== binding.actor_tenant || context.actor.userId !== binding.actor_user_id ||
      (context.ticket.relationshipId ?? null) !== binding.relationship_id) return deny();
    return work(context);
  }), upload, async (_context, row) => conversationEditorFileView(row));
}
export function downloadNamedConversationEditorFile(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, attachmentId: string, download: (path: string) => Promise<Uint8Array>) {
  const [file] = snapshotConversationEditorFiles([{ attachmentId }]);
  return withNamedTicketConversation(db, actor, ticket, conversation, 'read', async context => {
    const row = await conversationEditorFileQuery(editorScope(context)).where({ attachment_id: file.attachmentId, status: 'ready' }).forShare().first();
    if (!row) return deny();
    const content = await download(assertCoManagedAttachmentPath(row));
    if (content.length !== row.file_size || createHash('sha256').update(content).digest('hex') !== row.content_hash)
      throw new CoManagedAttachmentError('ATTACHMENT_CONTENT_MISMATCH');
    return { attachment: conversationEditorFileView(row), content };
  });
}
