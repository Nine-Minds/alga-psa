import { snapshotConversationDraftParent } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { createHash } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { selectConversationEditorFiles, type ConversationEditorFile } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { withNamedTicketConversation, type NamedConversationPostRequest } from './namedTicketConversations';
import { assertCoManagedSessionUnexpired, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationAttachmentSources } from './conversationPolicy';
import { CoManagedAttachmentError, snapshotConversationFileBytes, transferProtectedConversationFile } from './protectedConversationFileTransfer';

export interface NamedConversationFileStorage {
  download(path: string): Promise<Uint8Array>;
  upload(storeTenant: string, path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
}
export interface NamedConversationEmailFile extends ConversationEditorFile { storeTenant: string }
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
const TABLE = 'co_management_conversation_attachments';
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function namedConversationPublicationHash(actor: { tenant: string; userId: string }, ticket: ConversationTicketReference,
  reference: TicketConversationReference, request: NamedConversationPostRequest, mode: 'post' | 'send') {
  return digest({ actor: { tenant: actor.tenant, userId: actor.userId }, ticket, reference, request, mode });
}
/** Internal byte hydration after domain admission. Retained descriptors never
 * supply arbitrary storage paths, streams, URLs, or unverified content. */
export async function readNamedConversationFileBytes(file: NamedConversationEmailFile, storage: Pick<NamedConversationFileStorage, 'download'>) {
  if (![file.storeTenant, file.attachmentId].every(conversationUuid) || !/^[a-f0-9]{64}$/.test(file.contentHash)) return invalid();
  const bytes = Buffer.from(await storage.download(`co-management/${file.storeTenant}/${file.attachmentId}`));
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.contentHash) throw new CoManagedAttachmentError('ATTACHMENT_CONTENT_MISMATCH');
  return bytes;
}
export async function selectedNamedConversationEditorFiles(context: Context, draft: any): Promise<NamedConversationEmailFile[]> {
  if (!Array.isArray(draft.attachment_manifest)) return invalid();
  if (draft.attachment_manifest.length && isCoManagedReadFieldHidden(context.hidden,
    ['drafts', 'content', 'ticket_conversation_editor_drafts', ...coManagedConversationAttachmentSources])) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const files = await selectConversationEditorFiles({ ...context, conversationRevision: context.conversation.revision },
    draft.attachment_manifest.map((f: ConversationEditorFile) => ({ attachmentId: f.attachmentId })));
  if (files.some((file, index) => Object.entries(file).some(([key, value]) => draft.attachment_manifest[index][key] !== value))) return conflict();
  return files.map(f => ({ ...f, storeTenant: context.actor.tenant }));
}
function binding(context: Context, draft: any, request: NamedConversationPostRequest) {
  return { tenant: context.conversation.storeTenant, customer_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    relationship_id: context.ticket.relationshipId ?? null, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId,
    thread_id: draft.reply_thread_id ?? request.operationId, comment_id: request.operationId, draft_operation_id: null,
    named_publication_operation_id: request.operationId, external_author_email: null };
}
function copyIdentity(context: Context, draft: any, request: NamedConversationPostRequest, mode: 'post' | 'send', source: NamedConversationEmailFile) {
  const reference = { storeTenant: context.conversation.storeTenant, conversationId: context.conversation.conversationId };
  const attachmentId = uuidv5(`file:${source.storeTenant}:${source.attachmentId}`, request.operationId);
  const destination = binding(context, draft, request);
  return { attachmentId, destination, requestHash: digest({ publication: namedConversationPublicationHash(context.actor, context.ticket, reference, request, mode), source, destination, attachmentId }) };
}
async function admittedDraft(context: Context, request: NamedConversationPostRequest, mode: 'post' | 'send') {
  if (context.conversation.revision !== request.expectedConversationRevision) return conflict();
  if (context.conversation.audience === 'requester' || context.conversation.transport !== (mode === 'post' ? 'internal' : 'email')) return invalid();
  const draft = await tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_editor_drafts').where({ actor_user_id: context.actor.userId,
    ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_store_tenant: context.conversation.storeTenant,
    conversation_id: context.conversation.conversationId }).forUpdate().first();
  if (!draft?.content || draft.revision !== request.expectedDraftRevision || draft.conversation_revision !== request.expectedConversationRevision) return conflict();
  if (request.parent && (draft.reply_thread_id !== request.parent.threadId || draft.reply_comment_id !== request.parent.commentId)) return conflict();
  return draft;
}
/** Explicit Post/Send may stage destination copies. A ready copy remains hidden
 * until the matching accepted publication receipt commits with the message. */
export async function prepareNamedConversationPublicationFiles(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputRef: TicketConversationReference, input: NamedConversationPostRequest, mode: 'post' | 'send', storage: NamedConversationFileStorage) {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), ref = snapshotConversationReference(inputRef);
  if (db.isTransaction || !input || !conversationUuid(input.operationId) || !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 1 ||
    !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 ||
    Object.keys(input).some(k => !['operationId', 'expectedDraftRevision', 'expectedConversationRevision', 'parent'].includes(k)) || !['post', 'send'].includes(mode)) return invalid();
  const parent = snapshotConversationDraftParent(input.parent);
  const request: NamedConversationPostRequest = { operationId: input.operationId.toLowerCase(), expectedConversationRevision: input.expectedConversationRevision,
    expectedDraftRevision: input.expectedDraftRevision, ...(parent ? { parent } : {}) };
  const initial = await withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
    const previous = await tenantDb(context.trx, ref.storeTenant).table('ticket_conversation_publications').where('operation_id', request.operationId).first();
    if (previous) {
      if (previous.request_hash !== namedConversationPublicationHash(context.actor, context.ticket, ref, request, mode)) return conflict();
      return [];
    }
    const draft = await admittedDraft(context, request, mode);
    return selectedNamedConversationEditorFiles(context, draft);
  });
  try {
  for (const source of initial) {
    const withAuthority = <T>(work: (context: Context & { draft: any; assertWriteAuthority: () => Promise<void> }) => Promise<T>) =>
      withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
        const draft = await admittedDraft(context, request, mode), current = await selectedNamedConversationEditorFiles(context, draft);
        if (digest(current) !== digest(initial)) return conflict();
        return work({ ...context, draft, assertWriteAuthority: async () => {
          await assertCoManagedSessionUnexpired(context.trx, context.actor); await assertCoManagedOperationalWrite(context.trx, context.ticket.tenant);
        } });
      });
    const snapshot = await withAuthority(async context => ({ ...copyIdentity(context, context.draft, request, mode, source), content: await readNamedConversationFileBytes(source, storage) }));
    const file = snapshotConversationFileBytes({ ...source, attachmentId: snapshot.attachmentId, content: snapshot.content });
    await transferProtectedConversationFile(db, file, snapshot.destination, snapshot.requestHash, withAuthority,
      (path, bytes, mime) => storage.upload(ref.storeTenant, path, bytes, mime), async () => {});
  }
  } catch (error) {
    // A concurrent exact retry can finish publication while this call is between
    // reservations. The accepted receipt, not a now-consumed draft, settles it.
    if (!(error instanceof TicketConversationError && error.code === 'CONVERSATION_CONFLICT')) throw error;
    const accepted = await withNamedTicketConversation(db, actor, ticket, ref, 'update', async context => {
      const row = await tenantDb(context.trx, ref.storeTenant).table('ticket_conversation_publications').where('operation_id', request.operationId).first();
      return row?.request_hash === namedConversationPublicationHash(context.actor, context.ticket, ref, request, mode);
    });
    if (!accepted) throw error;
  }
}
/** Called under the draft/publication transaction. Every selected copy must be
 * ready and match this exact author, intent and immutable source bytes. */
export async function assertNamedConversationPublicationFiles(context: Context, draft: any, request: NamedConversationPostRequest, mode: 'post' | 'send') {
  const sources = await selectedNamedConversationEditorFiles(context, draft);
  const rows = await tenantDb(context.trx, context.conversation.storeTenant).table(TABLE).where('named_publication_operation_id', request.operationId).forShare();
  if (rows.length !== sources.length) return conflict();
  return sources.map(source => {
    const expected = copyIdentity(context, draft, request, mode, source), row = rows.find(r => r.attachment_id === expected.attachmentId);
    if (!row || row.status !== 'ready' || row.discarded_at || row.purged_at || row.request_hash !== expected.requestHash ||
      row.content_hash !== source.contentHash || row.file_size !== source.size || row.file_name !== source.fileName || row.mime_type !== source.mimeType ||
      row.storage_path !== `co-management/${context.conversation.storeTenant}/${expected.attachmentId}` ||
      Object.entries(expected.destination).some(([k, value]) => (row[k] ?? null) !== value)) return conflict();
    return { ...source, storeTenant: context.conversation.storeTenant, attachmentId: expected.attachmentId };
  });
}

/** A retained Send is still subject to current file and source authority when
 * delivery resumes. Its descriptors are not a permanent download capability. */
export async function assertNamedConversationDeliveryFiles(context: Context, operationId: string, files: NamedConversationEmailFile[] = []) {
  if (!files.length) return;
  const owner = tenantDb(context.trx, context.conversation.storeTenant);
  const publication = await owner.table('ticket_conversation_publications').where({ operation_id: operationId,
    conversation_id: context.conversation.conversationId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId, mode: 'send' }).forShare().first();
  if (!publication) return conflict();
  const { namedConversationMessageFileContext } = await import('./namedConversationAttachments');
  await namedConversationMessageFileContext(context, publication.comment_id, publication.thread_id);
  const rows = await owner.table(TABLE).where({ named_publication_operation_id: operationId, comment_id: publication.comment_id,
    thread_id: publication.thread_id, status: 'ready' }).whereNull('discarded_at').whereNull('purged_at').forShare();
  for (const file of files) {
    const row = rows.find(r => r.attachment_id === file.attachmentId);
    if (file.storeTenant !== context.conversation.storeTenant || !row || row.content_hash !== file.contentHash || row.file_size !== file.size ||
      row.file_name !== file.fileName || row.mime_type !== file.mimeType || row.storage_path !== `co-management/${file.storeTenant}/${file.attachmentId}`)
      throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  }
}
