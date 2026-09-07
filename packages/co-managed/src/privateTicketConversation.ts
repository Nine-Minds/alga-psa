import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedPrivateCommentReference { storeTenant: string; threadId: string; commentId: string }
export type CoManagedPrivateCommentCommand = { operationId: string } & (
  { kind: 'create'; text: string; parent?: CoManagedPrivateCommentReference } |
  { kind: 'edit'; text: string; comment: CoManagedPrivateCommentReference; expectedRevision: number } |
  { kind: 'delete'; comment: CoManagedPrivateCommentReference; expectedRevision: number });
export interface CoManagedPrivateCommentReceipt extends CoManagedPrivateCommentReference {
  operationId: string; revision: number; appliedAt: string;
}
export class CoManagedPrivateCommentError extends Error {
  constructor(public readonly code: 'INVALID_PRIVATE_COMMENT' | 'PRIVATE_COMMENT_CONFLICT' | 'PRIVATE_COMMENT_OPERATION_CONFLICT') {
    super({ INVALID_PRIVATE_COMMENT: 'The private note command is not valid.', PRIVATE_COMMENT_CONFLICT: 'The private note changed. Reload it before saving.',
      PRIVATE_COMMENT_OPERATION_CONFLICT: 'This operation was already used for a different command.' }[code]);
    this.name = 'CoManagedPrivateCommentError';
  }
}
function snapshotCommand(input: CoManagedPrivateCommentCommand): CoManagedPrivateCommentCommand {
  const invalid = (): never => { throw new CoManagedPrivateCommentError('INVALID_PRIVATE_COMMENT'); };
  if (!input || !['create', 'edit', 'delete'].includes(input.kind) || !isCoManagedUuid(input.operationId)) invalid();
  const keys = input.kind === 'create' ? ['operationId', 'kind', 'text', 'parent'] : input.kind === 'edit'
    ? ['operationId', 'kind', 'text', 'comment', 'expectedRevision'] : ['operationId', 'kind', 'comment', 'expectedRevision'];
  if (Object.keys(input).some(key => !keys.includes(key))) invalid();
  const reference = (value: CoManagedPrivateCommentReference): CoManagedPrivateCommentReference => {
    if (!value || Object.keys(value).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key)) ||
        ![value.storeTenant, value.threadId, value.commentId].every(isCoManagedUuid)) invalid();
    return { storeTenant: value.storeTenant.toLowerCase(), threadId: value.threadId.toLowerCase(), commentId: value.commentId.toLowerCase() };
  };
  if (input.kind !== 'delete' && (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100_000 || input.text.includes('\0'))) invalid();
  if (input.kind !== 'create' && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647)) invalid();
  const operationId = input.operationId.toLowerCase();
  if (input.kind === 'create') return { kind: 'create', operationId, text: input.text, ...(input.parent !== undefined ? { parent: reference(input.parent) } : {}) };
  const common = { operationId, comment: reference(input.comment), expectedRevision: input.expectedRevision };
  return input.kind === 'edit' ? { ...common, kind: 'edit', text: input.text } : { ...common, kind: 'delete' };
}
const contentSources = ['conversation', 'note', 'markdown_content', 'created_at', 'updated_at', 'thread_id', 'parent_comment_id', 'collaboration_audience',
  'co_management_private_threads', 'co_management_private_comments', 'revision'];
function assertVisible(context: CoManagedSharedWorkContext) {
  if (isCoManagedReadFieldHidden(context.redactedFields, contentSources)) throw new CoManagedSharedWorkError();
}
function receipt(row: any): CoManagedPrivateCommentReceipt {
  return { storeTenant: row.tenant, operationId: row.operation_id, threadId: row.thread_id, commentId: row.comment_id,
    revision: row.revision, appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at) };
}
function plainTextContent(text: string) {
  // This command accepts text, never caller-supplied HTML, block IDs, uploads or
  // embedded URLs. Encode text nodes so JSON-looking input stays literal text.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return { note: JSON.stringify(lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }))),
    markdown_content: lines.map(line => line.replace(/([\\`*_{}\[\]()#+\-.!|~>])/g, '\\$1').replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n\n') };
}

/** MSP-private notes stay entirely in the verified home store, including retry
 * receipts. Shared ticket authority is still required; retained archives have a
 * separate read boundary after live trust ends. No ticket event or customer-side
 * updated timestamp is emitted for organization-private activity. */
export async function mutateCoManagedPrivateTicketComment(db: Knex, inputActor: CoManagedSessionActor,
  inputResource: CoManagedSharedResource, input: CoManagedPrivateCommentCommand): Promise<CoManagedPrivateCommentReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), request = snapshotCommand(input);
  if (!inputResource || inputResource.kind !== 'ticket' || ![inputResource.tenant, inputResource.relationshipId, inputResource.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'ticket', tenant: inputResource.tenant.toLowerCase(), relationshipId: inputResource.relationshipId.toLowerCase(), id: inputResource.id.toLowerCase() };
  const target = request.kind === 'create' ? request.parent : request.comment;
  if (resource.tenant === actor.tenant || (target && target.storeTenant !== actor.tenant)) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern co-managed-command-receipt — ticket edits and private notes
  // share retry semantics, but private receipts must never use customer storage.
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, request })).digest('hex');
  try {
    return await withCoManagedSharedWork(db, actor, resource, 'update', context =>
      withCoManagedSharedWork(context.trx, actor, resource, 'read', async readContext => {
        assertVisible(context); assertVisible(readContext);
        const { trx } = context, home = tenantDb(trx, actor.tenant);
        const assertWrite = async () => { await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, resource.tenant); };
        const previous = await home.table('co_management_private_command_receipts').where('operation_id', request.operationId).forShare().first();
        if (previous) {
          if (previous.request_hash !== hash) throw new CoManagedPrivateCommentError('PRIVATE_COMMENT_OPERATION_CONFLICT');
          await assertWrite(); return receipt(previous);
        }
        let threadId = request.operationId;
        if (target) {
          const thread = await home.table('co_management_private_threads').where({ thread_id: target.threadId, customer_tenant: resource.tenant,
            relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id }).forUpdate().first();
          if (!thread) throw new CoManagedSharedWorkError();
          threadId = thread.thread_id;
          const root = await home.table('co_management_private_comments').where({ thread_id: threadId, comment_id: thread.root_comment_id }).forShare().first('deleted_at');
          if (!root || (request.kind === 'create' && root.deleted_at)) throw new CoManagedSharedWorkError();
        }
        let commentId: string, revision: number;
        if (request.kind === 'create') {
          if (target && !await home.table('co_management_private_comments').where({ thread_id: threadId, comment_id: target.commentId })
            .whereNull('deleted_at').forShare().first('comment_id')) throw new CoManagedSharedWorkError();
          const user = await home.table('users').where({ user_id: actor.userId, user_type: 'internal', is_inactive: false }).forShare().first('first_name', 'last_name', 'email');
          const organization = await home.table('tenants').forShare().first('client_name');
          if (!user || !organization) throw new CoManagedSharedWorkError();
          await assertWrite();
          commentId = request.operationId; revision = 1;
          if (!target) await home.table('co_management_private_threads').insert({ tenant: actor.tenant, thread_id: threadId, customer_tenant: resource.tenant,
            relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id, root_comment_id: commentId });
          await home.table('co_management_private_comments').insert({ tenant: actor.tenant, comment_id: commentId, thread_id: threadId,
            parent_comment_id: target?.commentId ?? null, actor_user_id: actor.userId,
            actor_display_name: [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(' ') || user.email || actor.userId,
            actor_organization_name: organization.client_name || actor.tenant, ...plainTextContent(request.text), revision });
        } else {
          const comment = await home.table('co_management_private_comments').where({ thread_id: threadId, comment_id: request.comment.commentId }).forUpdate().first();
          // Ordinary text changes never claim another technician's authorship.
          if (!comment || comment.actor_user_id !== actor.userId) throw new CoManagedSharedWorkError();
          if (comment.deleted_at || comment.revision !== request.expectedRevision) throw new CoManagedPrivateCommentError('PRIVATE_COMMENT_CONFLICT');
          await assertWrite();
          commentId = comment.comment_id; revision = comment.revision + 1;
          await home.table('co_management_private_comments').where('comment_id', commentId).update({ revision, updated_at: trx.raw('clock_timestamp()'),
            ...(request.kind === 'edit' ? plainTextContent(request.text) : { deleted_at: trx.raw('clock_timestamp()') }) });
        }
        await home.table('co_management_private_threads').where('thread_id', threadId).update({ last_activity_at: trx.raw('clock_timestamp()') });
        await assertWrite();
        const [saved] = await home.table('co_management_private_command_receipts').insert({ tenant: actor.tenant, operation_id: request.operationId,
          customer_tenant: resource.tenant, relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id,
          actor_user_id: actor.userId, command_type: request.kind, request_hash: hash, thread_id: threadId, comment_id: commentId, revision,
          applied_at: trx.raw('clock_timestamp()') }).returning('*');
        return receipt(saved);
      }));
  } catch (error) {
    if ((error as { code?: string })?.code === '23505' && ['co_management_private_command_receipts_pkey', 'co_management_private_comments_pkey', 'co_management_private_threads_pkey']
      .includes((error as { constraint?: string }).constraint ?? '')) throw new CoManagedPrivateCommentError('PRIVATE_COMMENT_OPERATION_CONFLICT');
    throw error;
  }
}
