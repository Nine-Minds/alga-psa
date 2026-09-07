import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { commentAudienceSql, resolveCommentAudience, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources } from './conversationPolicy';
import type { CoManagedCommentReference } from './ticketCommentCreation';
import { plainTextContent } from './conversationContent';

export type CoManagedCommentMutationRequest = {
  operationId: string; comment: CoManagedCommentReference;
  /** Exact timestamp returned by the conversation reader, including microseconds. */
  expectedUpdatedAt: string | null;
} & ({ kind: 'edit'; text: string } | { kind: 'delete' });
export interface CoManagedCommentMutationReceipt extends CoManagedCommentReference { operationId: string; updatedAt: string; deleted: boolean }
export interface CoManagedCommentMutationContext extends CoManagedSharedWorkContext {
  operationId: string; actorReferenceId?: string; audience: CommentAudience; threadId: string; commentId: string;
  updatedAt: string; assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
export type CoManagedCommentMutation = { kind: 'edit'; note: string; markdown_content: string } | { kind: 'delete' };
export class CoManagedCommentMutationError extends Error {
  constructor(public readonly code: 'INVALID_COMMENT_MUTATION' | 'COMMENT_MUTATION_CONFLICT' | 'COMMENT_MUTATION_OPERATION_CONFLICT') {
    super({ INVALID_COMMENT_MUTATION: 'The comment command is not valid.', COMMENT_MUTATION_CONFLICT: 'The comment changed. Reload it before saving.',
      COMMENT_MUTATION_OPERATION_CONFLICT: 'This operation was already used for a different command.' }[code]);
    this.name = 'CoManagedCommentMutationError';
  }
}
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
function snapshotRequest(input: CoManagedCommentMutationRequest): CoManagedCommentMutationRequest {
  const invalid = (): never => { throw new CoManagedCommentMutationError('INVALID_COMMENT_MUTATION'); };
  if (!input || !['edit', 'delete'].includes(input.kind) || !isCoManagedUuid(input.operationId) ||
      Object.keys(input).some(key => !['operationId', 'comment', 'expectedUpdatedAt', ...(input.kind === 'edit' ? ['kind', 'text'] : ['kind'])].includes(key))) invalid();
  const target = input.comment;
  if (!target || Object.keys(target).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key)) ||
      ![target.storeTenant, target.threadId, target.commentId].every(isCoManagedUuid)) invalid();
  if (input.expectedUpdatedAt !== null && (typeof input.expectedUpdatedAt !== 'string' || !timestampPattern.test(input.expectedUpdatedAt) || !Number.isFinite(Date.parse(input.expectedUpdatedAt)))) invalid();
  if (input.kind === 'edit' && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100_000 || input.text.includes('\0'))) invalid();
  const common = { operationId: input.operationId.toLowerCase(), expectedUpdatedAt: input.expectedUpdatedAt,
    comment: { storeTenant: target.storeTenant.toLowerCase(), threadId: target.threadId.toLowerCase(), commentId: target.commentId.toLowerCase() } };
  return input.kind === 'edit' ? { ...common, kind: 'edit', text: input.text } : { ...common, kind: 'delete' };
}
function assertVisible(context: CoManagedSharedWorkContext) {
  if (isCoManagedReadFieldHidden(context.redactedFields, [...coManagedConversationBodySources, 'comments', 'comment_threads'])) throw new CoManagedSharedWorkError();
}
const exactTimestamp = (trx: Knex.Transaction, column: string) => trx.raw(`to_char(?? AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, [column]);

/** Existing text and deletion commands never alter audience, ownership or author.
 * Exact retries return their committed version without repeating effects. */
export async function mutateCoManagedTicketComment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedCommentMutationRequest, apply: (context: CoManagedCommentMutationContext, mutation: CoManagedCommentMutation) => Promise<void>): Promise<CoManagedCommentMutationReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), request = snapshotRequest(input);
  if (!inputResource || inputResource.kind !== 'ticket' || ![inputResource.tenant, inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'ticket', tenant: inputResource.tenant.toLowerCase(), relationshipId: inputResource.relationshipId.toLowerCase(), id: inputResource.id.toLowerCase() };
  if (request.comment.storeTenant !== resource.tenant) throw new CoManagedSharedWorkError();
  const foreign = actor.tenant !== resource.tenant;
  const authorize = foreign ? withCoManagedSharedWork : withCoManagedCustomerTicket;
  // LEVERAGE: pattern co-managed-command-receipt — mutations retain the same
  // canonical ticket/operation atomicity as comment creation and field edits.
  const hash = createHash('sha256').update(JSON.stringify({ resource, actor: { tenant: actor.tenant, userId: actor.userId }, command: 'ticket_comment_mutation', request })).digest('hex');
  try {
    return await authorize(db, actor, resource, 'update', context => authorize(context.trx, actor, resource, 'read', async readContext => {
      assertVisible(context); assertVisible(readContext);
      const { trx } = context, owner = tenantDb(trx, resource.tenant);
      const assertWriteAuthority = async (current: Knex.Transaction) => {
        if (current !== trx) throw new CoManagedSharedWorkError();
        await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, resource.tenant);
      };
      const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare()
        .select('request_hash', { applied_at_exact: exactTimestamp(trx, 'applied_at') }).first();
      const result = (updatedAt: string): CoManagedCommentMutationReceipt => ({ ...request.comment, operationId: request.operationId, updatedAt, deleted: request.kind === 'delete' });
      if (previous) {
        if (previous.request_hash !== hash) throw new CoManagedCommentMutationError('COMMENT_MUTATION_OPERATION_CONFLICT');
        await assertWriteAuthority(trx); return result(previous.applied_at_exact);
      }
      const thread = await owner.table('comment_threads').where({ thread_id: request.comment.threadId, ticket_id: resource.id }).forUpdate().first();
      if (!thread) throw new CoManagedSharedWorkError();
      const audience = resolveCommentAudience(thread);
      const query = owner.table('comments as c').where({ 'c.comment_id': request.comment.commentId, 'c.thread_id': thread.thread_id, 'c.ticket_id': resource.id });
      owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
      owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
      const comment = await query.where('c.publish_state', 'published').where('root.publish_state', 'published').forUpdate('c', 'root')
        .select('c.*', { effective_audience: commentAudienceSql(trx, 't', 'root', 'c'), version_matches: trx.raw('c.updated_at IS NOT DISTINCT FROM ?::timestamptz', [request.expectedUpdatedAt]) }).first();
      if (!comment || comment.effective_audience !== audience || (foreign && audience === 'organization_private') || comment.author_type !== 'internal' || comment.contact_id != null) throw new CoManagedSharedWorkError();
      if (foreign) {
        const reference = comment.actor_reference_id && await owner.table('collaboration_actor_references').where({ actor_reference_id: comment.actor_reference_id,
          actor_tenant: actor.tenant, actor_user_id: actor.userId }).forShare().first('actor_reference_id');
        if (!reference || comment.user_id != null) throw new CoManagedSharedWorkError();
      } else if (comment.actor_reference_id || comment.user_id !== actor.userId) throw new CoManagedSharedWorkError();
      if (comment.deleted_at || !comment.version_matches) throw new CoManagedCommentMutationError('COMMENT_MUTATION_CONFLICT');
      const clock = await trx.raw(`SELECT to_char(GREATEST(clock_timestamp(), COALESCE(?::timestamptz, '-infinity'::timestamptz) + interval '1 microsecond') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`, [request.expectedUpdatedAt]);
      const updatedAt: string = clock.rows[0].value;
      await assertWriteAuthority(trx);
      await apply({ ...context, operationId: request.operationId, audience, actorReferenceId: comment.actor_reference_id ?? undefined, threadId: thread.thread_id,
        commentId: comment.comment_id, updatedAt, assertWriteAuthority }, request.kind === 'edit' ? { kind: 'edit', ...plainTextContent(request.text) } : { kind: 'delete' });
      await assertWriteAuthority(trx);
      await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId, relationship_id: resource.relationshipId,
        resource_type: 'ticket', resource_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId,
        command_type: `ticket_comment_${request.kind}`, request_hash: hash, applied_at: updatedAt });
      return result(updatedAt);
    }));
  } catch (error) {
    if ((error as { code?: string })?.code === '23505' && (error as { constraint?: string }).constraint === 'co_management_command_receipts_pkey') {
      throw new CoManagedCommentMutationError('COMMENT_MUTATION_OPERATION_CONFLICT');
    }
    throw error;
  }
}
