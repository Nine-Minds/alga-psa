import { createHash } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import type { Knex } from 'knex';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { snapshotConversationFileBytes, transferProtectedConversationFile } from './protectedConversationFileTransfer';
import { namedConversationMessageFileContext } from './namedConversationAttachments';
import { listPublishedCoManagedAttachments, readPublishedCoManagedAttachment, assertPublishedCoManagedAttachmentFingerprint } from './conversationAttachments';
import type { NamedConversationPolicyContext } from './namedTicketConversations';
import type { NamedConversationShareSource, NamedConversationShareProvenance } from './namedConversationShares';
import type { NamedConversationFileStorage } from './namedConversationPublicationFiles';
import { TicketConversationError, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import { selectConversationEditorFiles } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';

type Context = NamedConversationPolicyContext & { actor: CoManagedSessionActor; conversation: NamedTicketConversation; sourceConversation: NamedTicketConversation };
type SelectedFile = NamedConversationShareProvenance['attachments'][number];
const forbidden = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
async function sourceContext(context: Context, source: NamedConversationShareSource, ids: string[]) {
  const selected = await namedConversationMessageFileContext({ ...context, conversation: context.sourceConversation }, source.commentId, source.threadId);
  const files = await listPublishedCoManagedAttachments(selected);
  if (ids.some(id => !files.some(file => file.attachmentId === id))) return forbidden();
  if (files.filter(file => ids.includes(file.attachmentId)).reduce((size, file) => size + file.size, 0) > 26214400)
    throw new TicketConversationError('CONVERSATION_INVALID');
  return selected;
}
/** The preparation adapter repeats source/destination/draft revision admission
 * for every phase. Copies remain author-private staged uploads until draft CAS;
 * partial or unknown transfers follow the existing unpublished-file cleanup. */
export async function prepareNamedConversationShareFiles(db: Knex, operationId: string, source: NamedConversationShareSource, ids: string[],
  withAuthority: <T>(work: (context: Context) => Promise<T>) => Promise<T>, storage: NamedConversationFileStorage): Promise<SelectedFile[]> {
  const copies: SelectedFile[] = [];
  for (const id of ids) {
    const initial = await withAuthority(async context => {
      const selected = await sourceContext(context, source, ids);
      const { attachment, content } = await readPublishedCoManagedAttachment(selected, id, storage.download);
      const attachmentId = uuidv5(`share-file:${source.storeTenant}:${source.conversationId}:${source.commentId}:${id}`, operationId);
      const file = snapshotConversationFileBytes({ attachmentId, fileName: attachment.fileName, mimeType: attachment.mimeType, content });
      const binding = { tenant: context.actor.tenant, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId,
        customer_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, relationship_id: context.ticket.relationshipId ?? null,
        named_editor_store_tenant: context.conversation.storeTenant, named_editor_conversation_id: context.conversation.conversationId,
        comment_id: null, thread_id: null, draft_operation_id: null, external_author_email: null };
      return { file, binding, hash: digest({ binding, operationId, source, sourceAttachmentId: id,
        attachmentId, fileName: file.fileName, mimeType: file.mimeType, contentHash: file.contentHash, size: file.content.length }) };
    });
    const withFileAuthority = <T>(work: (context: Context & { assertWriteAuthority: () => Promise<void> }) => Promise<T>) =>
      withAuthority(async context => {
        const selected = await sourceContext(context, source, ids);
        await assertPublishedCoManagedAttachmentFingerprint(selected, id, initial.file.contentHash);
        if (context.actor.tenant !== initial.binding.tenant || context.actor.userId !== initial.binding.actor_user_id ||
          (context.ticket.relationshipId ?? null) !== initial.binding.relationship_id) return forbidden();
        return work({ ...context, assertWriteAuthority: async () => {
          await assertCoManagedSessionUnexpired(context.trx, context.actor);
          await assertCoManagedOperationalWrite(context.trx, context.ticket.tenant);
        } });
      });
    await transferProtectedConversationFile(db, initial.file, initial.binding, initial.hash, withFileAuthority,
      (path, bytes, mime) => storage.upload(initial.binding.tenant, path, bytes, mime), async () => {});
    copies.push({ sourceAttachmentId: id, editorAttachmentId: initial.file.attachmentId, contentHash: initial.file.contentHash });
  }
  return copies;
}
/** Final preparation retains current source-file authority, then verifies the
 * exact staged author/destination manifest. Source IDs cannot select a sibling
 * file or masquerade as destination upload IDs. */
export async function assertNamedConversationShareFiles(context: Context, source: NamedConversationShareSource, copies: SelectedFile[]) {
  if (!copies.length) return;
  const selected = await sourceContext(context, source, copies.map(file => file.sourceAttachmentId));
  for (const copy of copies) await assertPublishedCoManagedAttachmentFingerprint(selected, copy.sourceAttachmentId, copy.contentHash);
  const files = await selectConversationEditorFiles({ ...context, conversationRevision: context.conversation.revision },
    copies.map(file => ({ attachmentId: file.editorAttachmentId })));
  if (files.some((file, index) => file.contentHash !== copies[index].contentHash)) return forbidden();
}
