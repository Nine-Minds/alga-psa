import { assertCoManagedAttachmentPath } from './attachmentStoragePath';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedLifecycleError, assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { commentAudienceSql, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAttachmentSources } from './conversationPolicy';
import type { CoManagedCommentReference } from './ticketCommentCreation';

const TABLE = 'co_management_conversation_attachments';
export interface CoManagedAttachmentReference extends CoManagedCommentReference { attachmentId: string }
export interface CoManagedConversationAttachment extends CoManagedAttachmentReference {
  fileName: string; mimeType: string; size: number; audience: CommentAudience;
}
export interface CoManagedAttachmentUpload {
  attachmentId: string; comment: CoManagedCommentReference; fileName: string; mimeType: string; content: Uint8Array;
}
export class CoManagedAttachmentError extends Error {
  constructor(public readonly code: 'INVALID_ATTACHMENT' | 'ATTACHMENT_OPERATION_CONFLICT' | 'ATTACHMENT_CONTENT_MISMATCH') {
    super({ INVALID_ATTACHMENT: 'The attachment is not valid.', ATTACHMENT_OPERATION_CONFLICT: 'This upload was already used for another attachment.',
      ATTACHMENT_CONTENT_MISMATCH: 'The stored attachment does not match its original content.' }[code]);
    this.name = 'CoManagedAttachmentError';
  }
}
const deny = (): never => { throw new CoManagedSharedWorkError(); };
function reference(input: CoManagedCommentReference): CoManagedCommentReference {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key)) ||
      ![input.storeTenant, input.threadId, input.commentId].every(isCoManagedUuid)) deny();
  return { storeTenant: input.storeTenant.toLowerCase(), threadId: input.threadId.toLowerCase(), commentId: input.commentId.toLowerCase() };
}
function attachmentReference(input: CoManagedAttachmentReference): CoManagedAttachmentReference {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'threadId', 'commentId', 'attachmentId'].includes(key)) || !isCoManagedUuid(input.attachmentId)) deny();
  return { ...reference({ storeTenant: input.storeTenant, threadId: input.threadId, commentId: input.commentId }), attachmentId: input.attachmentId.toLowerCase() };
}
function resourceSnapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'ticket' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) deny();
  return { kind: 'ticket', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
export interface CoManagedAttachmentContext extends CoManagedSharedWorkContext { comment: CoManagedCommentReference; audience: CommentAudience; draftOperationId?: string }
/** Resource authority alone is insufficient for a file. Retain the published
 * comment/root and scope locks through transport; never accept a supplied audience. */
async function withComment<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  comment: CoManagedCommentReference, action: 'read' | 'update', work: (context: CoManagedAttachmentContext) => Promise<T>): Promise<T> {
  const foreign = actor.tenant !== resource.tenant, privateStore = comment.storeTenant !== resource.tenant;
  if (privateStore && (!foreign || comment.storeTenant !== actor.tenant)) deny();
  const authorize = foreign ? withCoManagedSharedWork : withCoManagedCustomerTicket;
  const run = async (context: CoManagedSharedWorkContext, redactions: readonly string[]) => {
    if (isCoManagedReadFieldHidden(redactions, [...coManagedConversationBodySources, ...coManagedConversationAttachmentSources,
      ...(privateStore ? ['co_management_private_comments', 'co_management_private_threads'] : ['comments', 'comment_threads'])])) deny();
    const { trx } = context, owner = tenantDb(trx, comment.storeTenant);
    let audience: CommentAudience;
    if (privateStore) {
      const thread = await owner.table('co_management_private_threads').where({ thread_id: comment.threadId,
        customer_tenant: resource.tenant, relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id }).forShare().first();
      if (!thread || thread.disclosure_operation_id) deny();
      const rows = await owner.table('co_management_private_comments').where('thread_id', comment.threadId)
        .whereIn('comment_id', [thread.root_comment_id, comment.commentId]).forShare();
      const row = rows.find(row => row.comment_id === comment.commentId), root = rows.find(row => row.comment_id === thread.root_comment_id);
      if (!row || !root || row.deleted_at || (action === 'update' && row.actor_user_id !== actor.userId)) deny();
      audience = 'organization_private';
    } else {
      const query = owner.table('comments as c').where({ 'c.comment_id': comment.commentId, 'c.thread_id': comment.threadId, 'c.ticket_id': resource.id });
      owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
      owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
      const row = await query.where('c.publish_state', 'published').where('root.publish_state', 'published').whereNull('c.deleted_at')
        .forShare('c', 't', 'root').select('c.*', { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
      if (!row || (foreign && !['requester', 'shared_it'].includes(row.audience))) deny();
      audience = row.audience;
      if (action === 'update') {
        if (row.author_type !== 'internal' || row.contact_id != null) deny();
        if (foreign) {
          if (row.user_id != null || !row.actor_reference_id || !await owner.table('collaboration_actor_references').where({ actor_reference_id: row.actor_reference_id,
            actor_tenant: actor.tenant, actor_user_id: actor.userId }).forShare().first()) deny();
        } else if (row.actor_reference_id || row.user_id !== actor.userId) deny();
      }
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work({ ...context, comment, audience });
    await assertCoManagedSessionUnexpired(trx, actor);
    if (action === 'update') await assertCoManagedOperationalWrite(trx, resource.tenant);
    return result;
  };
  return authorize(db, actor, resource, action, context => action === 'read' ? run(context, context.redactedFields)
    : authorize(context.trx, actor, resource, 'read', read => run(context, [...context.redactedFields, ...read.redactedFields])));
}
function summary(row: any, audience: CommentAudience): CoManagedConversationAttachment {
  return { storeTenant: row.tenant, threadId: row.thread_id, commentId: row.comment_id, attachmentId: row.attachment_id,
    fileName: row.file_name, mimeType: row.mime_type, size: row.file_size, audience };
}
/** Internal read engine context. Local requester admission may read retained
 * customer files across ended relationships; MSP admission always qualifies one. */
export interface CoManagedAttachmentReadContext {
  trx: Knex.Transaction; comment: CoManagedCommentReference; audience: CommentAudience;
  resource: Pick<CoManagedSharedResource, 'tenant' | 'id'> & { relationshipId?: string };
}
function attachmentQuery(context: CoManagedAttachmentReadContext) {
  return tenantDb(context.trx, context.comment.storeTenant).table(TABLE).where({ customer_tenant: context.resource.tenant,
    ticket_id: context.resource.id, thread_id: context.comment.threadId, comment_id: context.comment.commentId })
    .modify(query => { if (context.resource.relationshipId !== undefined) query.where('relationship_id', context.resource.relationshipId); });
}

function visibleAttachmentQuery(context: CoManagedAttachmentReadContext) {
  const published = tenantDb(context.trx, context.comment.storeTenant).table('co_management_conversation_drafts as d')
    .where({ 'd.status': 'published', 'd.customer_tenant': context.resource.tenant,
      'd.ticket_id': context.resource.id, 'd.thread_id': context.comment.threadId, 'd.operation_id': context.comment.commentId })
    .whereRaw('d.operation_id = co_management_conversation_attachments.draft_operation_id')
    .whereRaw('d.relationship_id = co_management_conversation_attachments.relationship_id');
  return attachmentQuery(context).whereNull('discarded_at').where(query => query.whereNull('draft_operation_id').orWhereExists(published));
}

/** Reserve an immutable upload before transport. Lost acknowledgements leave a
 * non-readable pending object; an exact retry uses the same bytes and path.
 * Requires a root connection so the pending reservation commits before transport.
 * No generic file/document row can bypass the inherited conversation audience. */
export async function uploadCoManagedConversationAttachment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedAttachmentUpload, upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>): Promise<CoManagedConversationAttachment> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), comment = reference(input?.comment);
  return transferCoManagedAttachment(db, actor, resource, input, work => withComment(db, actor, resource, comment, 'update', work), upload);
}

/** Internal transfer engine: published comments and private draft manifests supply
 * their own authority while retaining one immutable reservation/transport protocol. */
export async function transferCoManagedAttachment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, input: CoManagedAttachmentUpload,
  withAuthority: <T>(work: (context: CoManagedAttachmentContext) => Promise<T>) => Promise<T>,
  upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>): Promise<CoManagedConversationAttachment> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  return transferAuthorizedCoManagedAttachment(db, actor, inputResource, input, work => withAuthority(context => {
    if (context.sessionId !== actor.sessionId || context.action !== 'update') deny();
    return work({ ...context, action: 'update', assertWriteAuthority: async () => {
      await assertCoManagedSessionUnexpired(context.trx, actor);
      await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
    } });
  }), upload);
}

/** Transfer mechanics consume retained write authority rather than assuming a
 * session. Interactive callers retain their session checks; durable workers
 * retain their receipt, current actor/source policy and live fenced claim. */
export interface CoManagedAttachmentTransferContext {
  trx: Knex.Transaction; actor: ConversationAttachmentTransferActor; resource: ConversationAttachmentTransferResource;
  comment: CoManagedCommentReference; audience: CommentAudience; action: 'update'; draftOperationId?: string;
  assertWriteAuthority: () => Promise<void>;
}
export type ConversationAttachmentTransferActor = { tenant: string; userId: string; externalEmail?: never } | { tenant: string; userId: null; externalEmail: string };
export type ConversationAttachmentTransferResource = Omit<CoManagedSharedResource, 'relationshipId'> & { relationshipId?: string };
export async function transferAuthorizedCoManagedAttachment(db: Knex, inputActor: ConversationAttachmentTransferActor,
  inputResource: ConversationAttachmentTransferResource, input: CoManagedAttachmentUpload,
  withAuthority: <T>(work: (context: CoManagedAttachmentTransferContext) => Promise<T>) => Promise<T>,
  upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>,
  complete?: (context: CoManagedAttachmentTransferContext, attachment: CoManagedConversationAttachment, digest: string) => Promise<void>,
): Promise<CoManagedConversationAttachment> {
  if (!inputActor || !isCoManagedUuid(inputActor.tenant) || (inputActor.userId === null
    ? typeof inputActor.externalEmail !== 'string' || inputActor.externalEmail.length > 500 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(inputActor.externalEmail)
    : !isCoManagedUuid(inputActor.userId) || inputActor.externalEmail !== undefined)) deny();
  const actor = { tenant: inputActor.tenant, userId: inputActor.userId, ...(inputActor.externalEmail ? { externalEmail: inputActor.externalEmail } : {}) };
  if (!inputResource || inputResource.kind !== 'ticket' || ![inputResource.tenant, inputResource.id].every(isCoManagedUuid)) deny();
  const resource: ConversationAttachmentTransferResource = inputResource.relationshipId !== undefined ? resourceSnapshot(inputResource as CoManagedSharedResource)
    : { kind: 'ticket' as const, tenant: inputResource.tenant.toLowerCase(), id: inputResource.id.toLowerCase() };
  const comment = reference(input?.comment);
  if (!('relationshipId' in resource) && (actor.tenant !== resource.tenant || comment.storeTenant !== resource.tenant)) deny();
  const invalid = (): never => { throw new CoManagedAttachmentError('INVALID_ATTACHMENT'); };
  // LEVERAGE: pattern co-managed-attachment-metadata — manifests and byte transfers must accept the same metadata limits.
  if ((db as Knex.Transaction).isTransaction || !input || Object.keys(input).some(key => !['attachmentId', 'comment', 'fileName', 'mimeType', 'content'].includes(key)) || !isCoManagedUuid(input.attachmentId) ||
      typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(input.fileName) ||
      typeof input.mimeType !== 'string' || input.mimeType.length > 127 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.mimeType) ||
      !(input.content instanceof Uint8Array) || input.content.length > 26214400) invalid();
  const content = Buffer.from(input.content), contentHash = createHash('sha256').update(content).digest('hex');
  const attachmentId = input.attachmentId.toLowerCase(), fileName = input.fileName, mimeType = input.mimeType.toLowerCase();
  const hash = createHash('sha256').update(JSON.stringify({ resource, comment, actor, attachmentId,
    fileName, mimeType, contentHash, size: content.length })).digest('hex');
  const assertContext = (context: CoManagedAttachmentTransferContext) => {
    if (!context.trx.isTransaction || typeof context.assertWriteAuthority !== 'function' || context.action !== 'update' || context.actor.tenant !== actor.tenant || context.actor.userId !== actor.userId || context.actor.externalEmail !== actor.externalEmail ||
        context.resource.tenant !== resource.tenant || context.resource.relationshipId !== resource.relationshipId || context.resource.id !== resource.id || context.resource.kind !== 'ticket' ||
        context.comment.storeTenant !== comment.storeTenant || context.comment.threadId !== comment.threadId || context.comment.commentId !== comment.commentId) deny();
  };
  await withAuthority(async context => {
    assertContext(context);
    const owner = tenantDb(context.trx, comment.storeTenant);
    const previous = await owner.table(TABLE).where('attachment_id', attachmentId).forUpdate().first();
    if (previous) { if (previous.discarded_at) throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT'); if (previous.request_hash !== hash || previous.draft_operation_id !== (context.draftOperationId ?? null)) throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT'); await owner.table(TABLE).where('attachment_id', attachmentId).update({ last_activity_at: context.trx.raw('clock_timestamp()') }); return; }
    await owner.table(TABLE).insert({ tenant: comment.storeTenant, attachment_id: attachmentId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
      ticket_id: resource.id, thread_id: comment.threadId, comment_id: comment.commentId, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      external_author_email: actor.externalEmail ?? null,
      file_name: fileName, mime_type: mimeType, file_size: content.length, content_hash: contentHash, request_hash: hash,
      storage_path: `co-management/${comment.storeTenant}/${attachmentId}`, draft_operation_id: context.draftOperationId ?? null, status: 'pending' }).onConflict(['tenant', 'attachment_id']).ignore();
    const reserved = await owner.table(TABLE).where('attachment_id', attachmentId).forUpdate().first('request_hash', 'draft_operation_id');
    if (reserved?.request_hash !== hash || reserved?.draft_operation_id !== (context.draftOperationId ?? null)) throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT');
  });
  return withAuthority(async context => {
    assertContext(context);
    const row = await attachmentQuery(context).where('attachment_id', attachmentId).forUpdate().first();
    if (!row || row.discarded_at || row.request_hash !== hash || row.draft_operation_id !== (context.draftOperationId ?? null)) throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT');
    if (row.storage_path !== `co-management/${comment.storeTenant}/${attachmentId}`) deny();
    if (row.status !== 'ready') {
      await upload(row.storage_path, content, mimeType);
      await context.assertWriteAuthority();
      await attachmentQuery(context).where('attachment_id', attachmentId).update({ status: 'ready', ready_at: context.trx.raw('clock_timestamp()'), last_activity_at: context.trx.raw('clock_timestamp()') });
    } else await context.assertWriteAuthority();
    const attachment = summary(row, context.audience);
    await complete?.(context, attachment, contentHash);
    return attachment;
  });
}
export async function listCoManagedConversationAttachments(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  inputComment: CoManagedCommentReference): Promise<CoManagedConversationAttachment[]> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), comment = reference(inputComment);
  return withComment(db, actor, resource, comment, 'read', listPublishedCoManagedAttachments);
}
export async function downloadCoManagedConversationAttachment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedAttachmentReference, download: (path: string) => Promise<Uint8Array>): Promise<{ attachment: CoManagedConversationAttachment; content: Uint8Array }> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource);
  const { attachmentId, ...comment } = attachmentReference(input);
  return withComment(db, actor, resource, comment, 'read', context => readPublishedCoManagedAttachment(context, attachmentId, download));
}

export interface CoManagedAttachmentRemovalReceipt extends CoManagedAttachmentReference { removedAt: string }
/** The immutable qualified file identity is its removal idempotency key. Current
 * comment scope and original authorship are checked again even on an exact retry. */
export async function removeCoManagedConversationAttachment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedAttachmentReference): Promise<CoManagedAttachmentRemovalReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), qualified = attachmentReference(input);
  const { attachmentId, ...comment } = qualified;
  return withComment(db, actor, resource, comment, 'update', async context => {
    const owner = tenantDb(context.trx, comment.storeTenant);
    const row = await attachmentQuery(context).where({ attachment_id: attachmentId, status: 'ready' }).forUpdate().first();
    if (!row || row.actor_tenant !== actor.tenant || row.actor_user_id !== actor.userId) deny();
    await assertCoManagedSessionUnexpired(context.trx, actor); await assertCoManagedOperationalWrite(context.trx, resource.tenant);
    if (row.discarded_at) {
      if (row.removal_actor_tenant !== actor.tenant || row.removal_actor_user_id !== actor.userId) throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT');
      return { ...qualified, removedAt: new Date(row.discarded_at).toISOString() };
    }
    // An unrelated comment using a staged draft's future ID cannot authorize
    // removal of its hidden files. Only published attachments reach this path.
    if (!await visibleAttachmentQuery(context).where('attachment_id', attachmentId).first()) deny();
    const [removed] = await owner.table(TABLE).where('attachment_id', attachmentId).update({ discarded_at: context.trx.raw('clock_timestamp()'),
      removal_actor_tenant: actor.tenant, removal_actor_user_id: actor.userId, cleanup_next_attempt_at: context.trx.raw('clock_timestamp()') }).returning('discarded_at');
    return { ...qualified, removedAt: new Date(removed.discarded_at).toISOString() };
  });
}

/** Internal engines, called inside retained technician or requester admission.
 * They do not authenticate a request or accept browser-supplied contexts. */
export async function listPublishedCoManagedAttachments(context: CoManagedAttachmentReadContext): Promise<CoManagedConversationAttachment[]> {
  if (!context.trx.isTransaction) deny();
  const rows = await visibleAttachmentQuery(context).where('status', 'ready').forShare().orderBy('created_at').orderBy('attachment_id');
  return rows.map((row: any) => summary(row, context.audience));
}
export async function readPublishedCoManagedAttachment(context: CoManagedAttachmentReadContext, attachmentId: string,
  download: (path: string) => Promise<Uint8Array>): Promise<{ attachment: CoManagedConversationAttachment; content: Uint8Array }> {
  if (!context.trx.isTransaction || !isCoManagedUuid(attachmentId)) deny();
  const row = await visibleAttachmentQuery(context).where({ attachment_id: attachmentId.toLowerCase(), status: 'ready' }).forShare().first();
  if (!row) deny();
  assertCoManagedAttachmentPath(row);
  const content = await download(row.storage_path);
  if (content.length !== row.file_size || createHash('sha256').update(content).digest('hex') !== row.content_hash) throw new CoManagedAttachmentError('ATTACHMENT_CONTENT_MISMATCH');
  return { attachment: summary(row, context.audience), content };
}

/** UI hint only. Upload and removal repeat this authority check and do not trust
 * author IDs or an enabled button supplied by a browser. */
export async function canManageCoManagedConversationAttachments(db: Knex, inputActor: CoManagedSessionActor,
  inputResource: CoManagedSharedResource, inputComment: CoManagedCommentReference): Promise<boolean> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), comment = reference(inputComment);
  try { return await withComment(db, actor, resource, comment, 'update', async () => true); }
  catch (error) {
    if (error instanceof CoManagedSharedWorkError || isCoManagedLifecycleError(error)) return false;
    throw error;
  }
}

/** Compatibility name retained for existing upload-only consumers. */
export const canUploadCoManagedConversationAttachment = canManageCoManagedConversationAttachments;
