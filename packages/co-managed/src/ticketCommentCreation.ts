import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { commentAudienceSql, resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { ensureCoManagedActorReference } from './actorReferences';
import { encodeConversationContent, snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';
import { recordCoManagedTicketFirstResponse } from './ticketSla';

export interface CoManagedCommentReference { storeTenant: string; threadId: string; commentId: string }
export type CoManagedCommentCreateRequest = { operationId: string } & CoManagedConversationContent & (
  { audience: CommentAudience; parent?: never; expectedAudience?: never } | { parent: CoManagedCommentReference; audience?: never; expectedAudience?: CommentAudience });
export interface CoManagedCommentCreateReceipt extends CoManagedCommentReference { operationId: string; appliedAt: string }
export interface CoManagedCommentCreateContext extends CoManagedSharedWorkContext {
  actorReferenceId?: string; audience: CommentAudience; canUpdateResponseState: boolean; assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
export interface CoManagedCommentInsert {
  comment_id: string; ticket_id: string; thread_id: string; parent_comment_id: string | null;
  note: string; markdown_content: string; is_internal: boolean; is_resolution: false;
  author_type: 'internal'; user_id: string | null; publish_state: 'published';
}
export class CoManagedCommentCreateError extends Error {
  constructor(public readonly code: 'INVALID_COMMENT_CREATE' | 'COMMENT_CREATE_OPERATION_CONFLICT') {
    super(code === 'INVALID_COMMENT_CREATE' ? 'The conversation reply is not valid.' : 'This operation was already used for a different command.');
    this.name = 'CoManagedCommentCreateError';
  }
}
function snapshotRequest(input: CoManagedCommentCreateRequest): CoManagedCommentCreateRequest {
  const invalid = (): never => { throw new CoManagedCommentCreateError('INVALID_COMMENT_CREATE'); };
  if (!input || !isCoManagedUuid(input.operationId) ||
      Object.keys(input).some(key => !['operationId', 'text', 'document', 'audience', 'parent', 'expectedAudience'].includes(key))) invalid();
  let content: CoManagedConversationContent;
  try { content = snapshotConversationContent(input); } catch { return invalid(); }
  const base = { operationId: input.operationId.toLowerCase(), ...content };
  if (input.parent !== undefined) {
    const parent = input.parent;
    if (input.audience !== undefined || !parent || ![parent.storeTenant, parent.threadId, parent.commentId].every(isCoManagedUuid) ||
        Object.keys(parent).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key))) invalid();
    if (input.expectedAudience !== undefined && !['requester', 'shared_it', 'organization_private'].includes(input.expectedAudience)) invalid();
    return { ...base, parent: { storeTenant: parent.storeTenant.toLowerCase(), threadId: parent.threadId.toLowerCase(), commentId: parent.commentId.toLowerCase() },
      ...(input.expectedAudience !== undefined ? { expectedAudience: input.expectedAudience } : {}) };
  }
  if (input.expectedAudience !== undefined || !['requester', 'shared_it', 'organization_private'].includes(input.audience as string)) invalid();
  return { ...base, audience: input.audience! };
}
function assertContentVisible(context: CoManagedSharedWorkContext) {
  if (isCoManagedReadFieldHidden(context.redactedFields, ['conversation', 'comments', 'comment_threads', 'note', 'markdown_content', 'thread_id', 'parent_comment_id',
    'created_at', 'updated_at', 'collaboration_audience'])) throw new CoManagedSharedWorkError();
}

/** Retains authority and receipts around the existing comment mutation engine.
 * The application adapter supplies that engine and its after-commit effects;
 * neither a copied ticket nor a copied MSP login is introduced. */
export async function createCoManagedTicketComment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedCommentCreateRequest, apply: (context: CoManagedCommentCreateContext, comment: CoManagedCommentInsert) => Promise<void>): Promise<CoManagedCommentCreateReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), request = snapshotRequest(input);
  if (!inputResource || inputResource.kind !== 'ticket' || ![inputResource.tenant, inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'ticket', tenant: inputResource.tenant.toLowerCase(), relationshipId: inputResource.relationshipId.toLowerCase(), id: inputResource.id.toLowerCase() };
  const foreign = actor.tenant !== resource.tenant;
  if ((request.parent && request.parent.storeTenant !== resource.tenant) || (foreign && request.audience === 'organization_private')) throw new CoManagedSharedWorkError();
  const authorize = foreign ? withCoManagedSharedWork : withCoManagedCustomerTicket;
  // LEVERAGE: pattern co-managed-command-receipt — comment creation uses the
  // same owner/operation atomicity as canonical field edits.
  const hash = createHash('sha256').update(JSON.stringify({ resource, actor: { tenant: actor.tenant, userId: actor.userId }, command: 'ticket_comment_create', request })).digest('hex');
  try {
    return await authorize(db, actor, resource, 'update', context => authorize(context.trx, actor, resource, 'read', async readContext => {
      assertContentVisible(context); assertContentVisible(readContext);
      const { trx } = context, owner = tenantDb(trx, resource.tenant);
      const assertWriteAuthority = async (current: Knex.Transaction) => {
        if (current !== trx) throw new CoManagedSharedWorkError();
        await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, resource.tenant);
      };
      const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
      const threadId = request.parent?.threadId ?? request.operationId;
      const result = (appliedAt: Date | string): CoManagedCommentCreateReceipt => ({ operationId: request.operationId, storeTenant: resource.tenant, threadId,
        commentId: request.operationId, appliedAt: appliedAt instanceof Date ? appliedAt.toISOString() : String(appliedAt) });
      if (previous) {
        if (previous.request_hash !== hash) throw new CoManagedCommentCreateError('COMMENT_CREATE_OPERATION_CONFLICT');
        await assertWriteAuthority(trx); return result(previous.applied_at);
      }
      let audience = request.audience;
      // LEVERAGE: pattern co-managed-conversation-destination — draft staging must preserve this root and parent audience admission.
      if (request.parent) {
        const thread = await owner.table('comment_threads').where({ thread_id: threadId, ticket_id: resource.id }).forUpdate().first();
        if (!thread) throw new CoManagedSharedWorkError();
        audience = resolveCommentAudience(thread);
        // Stricter legacy root/reply visibility must agree with the thread. A
        // reply cannot turn an inconsistent private branch into shared content.
        const query = owner.table('comments as parent').where({ 'parent.comment_id': request.parent.commentId, 'parent.thread_id': threadId, 'parent.ticket_id': resource.id });
        owner.tenantJoin(query, 'comment_threads as t', 'parent.thread_id', 't.thread_id');
        owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
        const parent = await query.where('parent.publish_state', 'published').where('root.publish_state', 'published').whereNull('parent.deleted_at').whereNull('root.deleted_at')
          .forShare('parent', 'root').select({ audience: commentAudienceSql(trx, 't', 'root', 'parent') }).first();
        if (!parent || parent.audience !== audience || (foreign && audience === 'organization_private')) throw new CoManagedSharedWorkError();
      }
      if (!audience || (request.expectedAudience !== undefined && request.expectedAudience !== audience)) throw new CoManagedSharedWorkError();
      const actorReferenceId = foreign ? await ensureCoManagedActorReference(context) : undefined;
      await assertWriteAuthority(trx);
      await apply({ ...context, actorReferenceId, audience, assertWriteAuthority,
        canUpdateResponseState: !isCoManagedReadFieldHidden([...context.redactedFields, ...readContext.redactedFields], ['response_state', 'tickets.response_state']) }, { comment_id: request.operationId, ticket_id: resource.id, thread_id: threadId,
        parent_comment_id: request.parent?.commentId ?? null, ...encodeConversationContent(request), is_internal: audience !== 'requester', is_resolution: false,
        author_type: 'internal', user_id: foreign ? null : actor.userId, publish_state: 'published' });
      await recordCoManagedTicketFirstResponse(context, request.operationId, actorReferenceId);
      await assertWriteAuthority(trx);
      const [saved] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId,
        relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId,
        command_type: 'ticket_comment_create', request_hash: hash, applied_at: trx.raw('clock_timestamp()') }).returning('applied_at');
      await assertWriteAuthority(trx);
      return result(saved.applied_at);
    }));
  } catch (error) {
    if ((error as { code?: string })?.code === '23505' && ['co_management_command_receipts_pkey', 'comments_pkey', 'comment_threads_pkey'].includes((error as { constraint?: string }).constraint ?? '')) {
      throw new CoManagedCommentCreateError('COMMENT_CREATE_OPERATION_CONFLICT');
    }
    throw error;
  }
}
