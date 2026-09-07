import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { commentAudienceSql, resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, lockCoManagedSessionIdentity, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAttachmentSources } from './conversationPolicy';
import { snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';
import type { CoManagedCommentReference, CoManagedCommentCreateRequest, CoManagedCommentCreateReceipt } from './ticketCommentCreation';
import { mutateCoManagedPrivateTicketComment, type CoManagedPrivateCommentReceipt } from './privateTicketConversation';
import { discardCoManagedDraft } from './uploadCleanup';
import { transferCoManagedAttachment, type CoManagedAttachmentContext } from './conversationAttachments';

const TABLE = 'co_management_conversation_drafts', FILES = 'co_management_conversation_attachments';
export interface CoManagedDraftFile { attachmentId: string; fileName: string; mimeType: string; size: number; contentHash: string }
export type CoManagedConversationDraftRequest = { operationId: string; content: CoManagedConversationContent; files: CoManagedDraftFile[] } &
  ({ audience: CommentAudience; parent?: never; expectedAudience?: never } | { parent: CoManagedCommentReference; audience?: never; expectedAudience?: CommentAudience });
export interface CoManagedConversationDraftReference { storeTenant: string; operationId: string }
export interface CoManagedConversationDraftProgress extends CoManagedConversationDraftReference { status: 'draft' | 'published'; uploadedAttachmentIds: string[] }
export type CoManagedConversationDraftReceipt = CoManagedCommentCreateReceipt | CoManagedPrivateCommentReceipt;
export class CoManagedConversationDraftError extends Error {
  constructor(public readonly code: 'INVALID_CONVERSATION_DRAFT' | 'CONVERSATION_DRAFT_CONFLICT' | 'CONVERSATION_DRAFT_NOT_READY' | 'CONVERSATION_DRAFT_ABANDONED') {
    super({ INVALID_CONVERSATION_DRAFT: 'The message draft is not valid.', CONVERSATION_DRAFT_CONFLICT: 'This draft operation was already used for another message.',
      CONVERSATION_DRAFT_ABANDONED: 'This message draft has been discarded.',
      CONVERSATION_DRAFT_NOT_READY: 'All message attachments must finish uploading before publication.' }[code]); this.name = 'CoManagedConversationDraftError';
  }
}
function invalid(): never { throw new CoManagedConversationDraftError('INVALID_CONVERSATION_DRAFT'); }
function conflict(): never { throw new CoManagedConversationDraftError('CONVERSATION_DRAFT_CONFLICT'); }
function deny(): never { throw new CoManagedSharedWorkError(); }
function targetSnapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'ticket' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) deny();
  return { kind: 'ticket', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
function snapshotRequest(input: CoManagedConversationDraftRequest): CoManagedConversationDraftRequest {
  if (!input || !isCoManagedUuid(input.operationId) || Object.keys(input).some(key => !['operationId', 'content', 'files', 'parent', 'audience', 'expectedAudience'].includes(key)) ||
      !input.content || Object.keys(input.content).some(key => !['text', 'document'].includes(key)) || !Array.isArray(input.files) || !input.files.length || input.files.length > 20) invalid();
  let content: CoManagedConversationContent; try { content = snapshotConversationContent(input.content); } catch { return invalid(); }
  const ids = new Set<string>();
  const files = input.files.map(file => {
    // LEVERAGE: pattern co-managed-attachment-metadata — manifests and byte transfers must accept the same metadata limits.
    if (!file || Object.keys(file).some(key => !['attachmentId', 'fileName', 'mimeType', 'size', 'contentHash'].includes(key)) || !isCoManagedUuid(file.attachmentId) ||
        typeof file.fileName !== 'string' || !file.fileName.trim() || file.fileName.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(file.fileName) ||
        typeof file.mimeType !== 'string' || file.mimeType.length > 127 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mimeType) ||
        !Number.isInteger(file.size) || file.size < 0 || file.size > 26214400 || typeof file.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(file.contentHash)) invalid();
    const attachmentId = file.attachmentId.toLowerCase(); if (ids.has(attachmentId)) invalid(); ids.add(attachmentId);
    return { attachmentId, fileName: file.fileName, mimeType: file.mimeType.toLowerCase(), size: file.size, contentHash: file.contentHash };
  }).sort((a, b) => a.attachmentId.localeCompare(b.attachmentId));
  const base = { operationId: input.operationId.toLowerCase(), content, files };
  if (input.parent !== undefined) {
    const parent = input.parent;
    if (input.audience !== undefined || !parent || Object.keys(parent).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key)) ||
        ![parent.storeTenant, parent.threadId, parent.commentId].every(isCoManagedUuid)) invalid();
    if (input.expectedAudience !== undefined && !['requester', 'shared_it', 'organization_private'].includes(input.expectedAudience)) invalid();
    return { ...base, parent: { storeTenant: parent.storeTenant.toLowerCase(), threadId: parent.threadId.toLowerCase(), commentId: parent.commentId.toLowerCase() },
      ...(input.expectedAudience !== undefined ? { expectedAudience: input.expectedAudience } : {}) };
  }
  if (input.expectedAudience !== undefined || !['requester', 'shared_it', 'organization_private'].includes(input.audience as string)) invalid();
  return { ...base, audience: input.audience! };
}
function draftReference(input: CoManagedConversationDraftReference): CoManagedConversationDraftReference {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'operationId'].includes(key)) || ![input.storeTenant, input.operationId].every(isCoManagedUuid)) invalid();
  return { storeTenant: input.storeTenant.toLowerCase(), operationId: input.operationId.toLowerCase() };
}
async function withBase<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, store: string,
  work: (context: CoManagedSharedWorkContext) => Promise<T>): Promise<T> {
  const foreign = actor.tenant !== resource.tenant, privateStore = store !== resource.tenant;
  if (privateStore && (!foreign || store !== actor.tenant)) deny();
  const authorize = foreign ? withCoManagedSharedWork : withCoManagedCustomerTicket;
  return authorize(db, actor, resource, 'update', context => authorize(context.trx, actor, resource, 'read', async read => {
    if (isCoManagedReadFieldHidden([...context.redactedFields, ...read.redactedFields], [...coManagedConversationBodySources, ...coManagedConversationAttachmentSources, TABLE,
      ...(privateStore ? ['co_management_private_comments', 'co_management_private_threads'] : ['comments', 'comment_threads'])])) deny();
    const result = await work(context);
    await assertCoManagedSessionUnexpired(context.trx, actor); await assertCoManagedOperationalWrite(context.trx, resource.tenant);
    return result;
  }));
}
// LEVERAGE: pattern co-managed-conversation-destination — draft staging and canonical creation share strict published-root reply admission.
async function destination(context: CoManagedSharedWorkContext, request: CoManagedConversationDraftRequest, store: string): Promise<CoManagedAttachmentContext> {
  const { trx, actor, resource } = context, owner = tenantDb(trx, store), privateStore = store !== resource.tenant;
  let audience = request.audience;
  if (request.parent) {
    if (request.parent.storeTenant !== store) deny();
    if (privateStore) {
      const thread = await owner.table('co_management_private_threads').where({ thread_id: request.parent.threadId, customer_tenant: resource.tenant,
        relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id }).forShare().first();
      if (!thread || thread.disclosure_operation_id) deny();
      const rows = await owner.table('co_management_private_comments').where('thread_id', thread.thread_id)
        .whereIn('comment_id', [request.parent.commentId, thread.root_comment_id]).whereNull('deleted_at').forShare();
      if (!rows.some(row => row.comment_id === request.parent!.commentId) || !rows.some(row => row.comment_id === thread.root_comment_id)) deny();
      audience = 'organization_private';
    } else {
      const thread = await owner.table('comment_threads').where({ thread_id: request.parent.threadId, ticket_id: resource.id }).forShare().first();
      if (!thread) deny();
      const query = owner.table('comments as c').where({ 'c.comment_id': request.parent.commentId, 'c.thread_id': thread.thread_id, 'c.ticket_id': resource.id });
      owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
      owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
      const parent = await query.where('c.publish_state', 'published').where('root.publish_state', 'published').whereNull('c.deleted_at').whereNull('root.deleted_at')
        .forShare('c', 'root').select({ audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
      if (!parent || parent.audience !== resolveCommentAudience(thread)) deny();
      audience = parent.audience;
    }
  }
  if (request.expectedAudience !== undefined && request.expectedAudience !== audience) deny();
  if (!audience || (privateStore && audience !== 'organization_private') || (!privateStore && actor.tenant !== resource.tenant && audience === 'organization_private')) deny();
  return { ...context, audience, draftOperationId: request.operationId,
    comment: { storeTenant: store, threadId: request.parent?.threadId ?? request.operationId, commentId: request.operationId } };
}
async function withDraft<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, reference: CoManagedConversationDraftReference,
  work: (context: CoManagedAttachmentContext, row: any) => Promise<T>): Promise<T> {
  return withBase(db, actor, resource, reference.storeTenant, async context => {
    const row = await tenantDb(context.trx, reference.storeTenant).table(TABLE).where({ operation_id: reference.operationId, customer_tenant: resource.tenant,
      relationship_id: resource.relationshipId, ticket_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId }).forUpdate().first();
    if (!row) deny();
    if (row.abandoned_at) throw new CoManagedConversationDraftError('CONVERSATION_DRAFT_ABANDONED');
    if (row.status === 'draft') await tenantDb(context.trx, reference.storeTenant).table(TABLE).where('operation_id', row.operation_id).update({ last_activity_at: context.trx.raw('clock_timestamp()') });
    const request = snapshotRequest({ ...row.request, files: row.manifest });
    const admitted = await destination(context, request, reference.storeTenant);
    if (admitted.audience !== row.audience || admitted.comment.threadId !== row.thread_id) deny();
    await assertCoManagedSessionUnexpired(context.trx, actor);
    await assertCoManagedOperationalWrite(context.trx, resource.tenant);
    return work(admitted, row);
  });
}
async function progress(context: CoManagedAttachmentContext, row: any): Promise<CoManagedConversationDraftProgress> {
  const files = await tenantDb(context.trx, context.comment.storeTenant).table(FILES).where({ draft_operation_id: row.operation_id, status: 'ready' }).whereNull('discarded_at').select('attachment_id');
  return { storeTenant: context.comment.storeTenant, operationId: row.operation_id, status: row.status, uploadedAttachmentIds: files.map(file => file.attachment_id) };
}
async function rejectExistingMessage(context: CoManagedAttachmentContext) {
  const owner = tenantDb(context.trx, context.comment.storeTenant), privateStore = context.comment.storeTenant !== context.resource.tenant;
  if (await owner.table(privateStore ? 'co_management_private_comments' : 'comments').where('comment_id', context.comment.commentId).first() ||
      await owner.table(privateStore ? 'co_management_private_command_receipts' : 'co_management_command_receipts').where('operation_id', context.comment.commentId).first()) conflict();
}
export async function beginCoManagedConversationDraft(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedConversationDraftRequest): Promise<CoManagedConversationDraftProgress> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = targetSnapshot(inputResource), request = snapshotRequest(input);
  if ((db as Knex.Transaction).isTransaction) invalid();
  const store = request.parent?.storeTenant ?? (request.audience === 'organization_private' && actor.tenant !== resource.tenant ? actor.tenant : resource.tenant);
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, request })).digest('hex');
  return withBase(db, actor, resource, store, async base => {
    const context = await destination(base, request, store), owner = tenantDb(context.trx, store);
    let row = await owner.table(TABLE).where('operation_id', request.operationId).forUpdate().first();
    if (!row) {
      await rejectExistingMessage(context);
      const { files, ...message } = request;
      await owner.table(TABLE).insert({ tenant: store, operation_id: request.operationId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
        ticket_id: resource.id, thread_id: context.comment.threadId, actor_tenant: actor.tenant, actor_user_id: actor.userId, audience: context.audience,
        request: message, manifest: JSON.stringify(files), request_hash: hash }).onConflict(['tenant', 'operation_id']).ignore();
      row = await owner.table(TABLE).where('operation_id', request.operationId).forUpdate().first();
    }
    if (row.request_hash !== hash || row.audience !== context.audience) conflict();
    if (row.abandoned_at) throw new CoManagedConversationDraftError('CONVERSATION_DRAFT_ABANDONED');
    if (row.status === 'draft') await owner.table(TABLE).where('operation_id', row.operation_id).update({ last_activity_at: base.trx.raw('clock_timestamp()') });
    return progress(context, row);
  });
}
export async function uploadCoManagedDraftAttachment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  inputReference: CoManagedConversationDraftReference, inputAttachmentId: string, inputContent: Uint8Array,
  upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = targetSnapshot(inputResource), reference = draftReference(inputReference);
  if ((db as Knex.Transaction).isTransaction || !isCoManagedUuid(inputAttachmentId) || !(inputContent instanceof Uint8Array) || inputContent.length > 26214400) invalid();
  const attachmentId = inputAttachmentId.toLowerCase(), content = Buffer.from(inputContent), digest = createHash('sha256').update(content).digest('hex');
  const prepared = await withDraft(db, actor, resource, reference, async (context, row) => {
    const file = (row.manifest as CoManagedDraftFile[]).find(file => file.attachmentId === attachmentId);
    if (!file || file.size !== content.length || file.contentHash !== digest) conflict();
    return { file, comment: context.comment };
  });
  return transferCoManagedAttachment(db, actor, resource, { attachmentId, comment: prepared.comment, fileName: prepared.file.fileName, mimeType: prepared.file.mimeType, content },
    work => withDraft(db, actor, resource, reference, async (context, row) => {
      if (row.status === 'published' && !await tenantDb(context.trx, reference.storeTenant).table(FILES).where({ attachment_id: attachmentId,
        draft_operation_id: reference.operationId, status: 'ready', content_hash: digest, file_size: content.length }).whereNull('discarded_at').forShare().first()) conflict();
      return work(context);
    }), upload);
}
function checkedReceipt(value: any, context: CoManagedAttachmentContext): CoManagedConversationDraftReceipt {
  const privateStore = context.comment.storeTenant !== context.resource.tenant;
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['operationId', 'storeTenant', 'threadId', 'commentId', 'appliedAt', ...(privateStore ? ['revision'] : [])].includes(key)) ||
      value.operationId !== context.draftOperationId || value.commentId !== context.comment.commentId || value.storeTenant !== context.comment.storeTenant || value.threadId !== context.comment.threadId ||
      typeof value.appliedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value.appliedAt) || !Number.isFinite(Date.parse(value.appliedAt)) ||
      (privateStore && (!Number.isInteger(value.revision) || value.revision < 1))) conflict();
  return { operationId: value.operationId, storeTenant: value.storeTenant, threadId: value.threadId, commentId: value.commentId,
    appliedAt: value.appliedAt, ...(privateStore ? { revision: value.revision } : {}) };
}
export async function publishCoManagedConversationDraft(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  inputReference: CoManagedConversationDraftReference,
  publishCustomer: (trx: Knex.Transaction, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentCreateRequest) => Promise<CoManagedCommentCreateReceipt>): Promise<CoManagedConversationDraftReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = targetSnapshot(inputResource), reference = draftReference(inputReference);
  return withDraft(db, actor, resource, reference, async (context, row) => {
    if (row.status === 'published') return checkedReceipt(row.receipt, context);
    await rejectExistingMessage(context);
    const owner = tenantDb(context.trx, reference.storeTenant), manifest: CoManagedDraftFile[] = row.manifest;
    const files = await owner.table(FILES).where({ draft_operation_id: row.operation_id, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
      ticket_id: resource.id, thread_id: context.comment.threadId, comment_id: row.operation_id, status: 'ready' }).forShare();
    if (files.length !== manifest.length || manifest.some(file => !files.some(saved => saved.attachment_id === file.attachmentId && saved.content_hash === file.contentHash &&
      saved.file_size === file.size && saved.file_name === file.fileName && saved.mime_type === file.mimeType))) throw new CoManagedConversationDraftError('CONVERSATION_DRAFT_NOT_READY');
    const request = snapshotRequest({ ...row.request, files: manifest });
    const common = { operationId: row.operation_id, ...request.content };
    const receipt = reference.storeTenant !== resource.tenant
      ? await mutateCoManagedPrivateTicketComment(context.trx, actor, resource, { ...common, kind: 'create', ...(request.parent ? { parent: request.parent } : {}) })
      : await publishCustomer(context.trx, actor, resource, { ...common, ...(request.parent ? { parent: request.parent, ...(request.expectedAudience !== undefined ? { expectedAudience: request.expectedAudience } : {}) } : { audience: request.audience! }) });
    checkedReceipt(receipt, context);
    await owner.table(TABLE).where('operation_id', row.operation_id).update({ status: 'published', receipt: JSON.stringify(receipt), published_at: context.trx.raw('clock_timestamp()') });
    return receipt;
  });
}

/** An active author may discard their own unpublished draft even after content
 * grants or the license lapse. Cancellation neither reads nor modifies live work. */
export async function abandonCoManagedConversationDraft(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  inputReference: CoManagedConversationDraftReference): Promise<{ status: 'abandoned' | 'published' }> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = targetSnapshot(inputResource), reference = draftReference(inputReference);
  if (reference.storeTenant !== resource.tenant && reference.storeTenant !== actor.tenant) deny();
  return withTransaction(db, async trx => {
    await lockCoManagedSessionIdentity(trx, actor);
    const row = await tenantDb(trx, reference.storeTenant).table(TABLE).where({ operation_id: reference.operationId, customer_tenant: resource.tenant,
      relationship_id: resource.relationshipId, ticket_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId }).forUpdate().first();
    if (!row) deny();
    await assertCoManagedSessionUnexpired(trx, actor);
    if (row.status === 'published') return { status: 'published' as const };
    await discardCoManagedDraft(trx, reference.storeTenant, row);
    await assertCoManagedSessionUnexpired(trx, actor);
    return { status: 'abandoned' as const };
  });
}
