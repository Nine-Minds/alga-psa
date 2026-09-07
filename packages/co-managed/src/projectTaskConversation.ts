import { retainCoManagedTaskCommentEvent } from './projectTaskEvents';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, isCoManagedLifecycleError } from '@alga-psa/licensing';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedCustomerProject } from './customerWork';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { ensureCoManagedActorReference } from './actorReferences';
import { encodeConversationContent, snapshotConversationContent, type CoManagedConversationContent } from './conversationContent';
import { coManagedConversationBodySources, coManagedConversationAuthorSources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { mutateCoManagedPrivateTaskComment } from './privateTicketConversation';
import type { CoManagedCommentReference } from './ticketCommentCreation';
import { projectTaskAudienceSql, projectTaskAudience as audienceOf } from './projectTaskAudience';
export { projectTaskAudienceSql } from './projectTaskAudience';
import type { CoManagedConversationCursor, CoManagedConversationItem } from './ticketConversation';

/** Structural reply eligibility; the screen also requires a current write audience. */
export interface CoManagedTaskConversationItem extends CoManagedConversationItem { canReply: boolean }

export type CoManagedTaskCommentCommand = { operationId: string } & (
  ({ kind: 'create'; audience?: CommentAudience; parent?: CoManagedCommentReference; expectedAudience?: CommentAudience } & CoManagedConversationContent) |
  ({ kind: 'edit'; comment: CoManagedCommentReference; expectedRevision: number } & CoManagedConversationContent) |
  { kind: 'delete'; comment: CoManagedCommentReference; expectedRevision: number });
export class CoManagedTaskCommentError extends Error {
  constructor(readonly code: 'INVALID_TASK_COMMENT' | 'TASK_COMMENT_CONFLICT' | 'TASK_COMMENT_OPERATION_CONFLICT') { super(code); }
}
const deny = () => { throw new CoManagedSharedWorkError(); };
const audienceNames = ['requester', 'shared_it', 'organization_private'] as const;
const bodySources = [...coManagedConversationBodySources, 'project_task_comments', 'comment_threads', 'collaboration_revision'] as const;
function resourceSnapshot(value: CoManagedSharedResource): CoManagedSharedResource {
  if (!value || value.kind !== 'project_task' || ![value.tenant, value.id, value.relationshipId].every(isCoManagedUuid)) deny();
  return { kind: 'project_task', tenant: value.tenant.toLowerCase(), relationshipId: value.relationshipId.toLowerCase(), id: value.id.toLowerCase() };
}
const boundary = (actor: CoManagedSessionActor, resource: CoManagedSharedResource) => actor.tenant === resource.tenant ? withCoManagedCustomerProject : withCoManagedSharedWork;
async function current(context: CoManagedSharedWorkContext, write = false) {
  await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
  if (write) await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
}
function commandSnapshot(input: CoManagedTaskCommentCommand): CoManagedTaskCommentCommand {
  const invalid = () => { throw new CoManagedTaskCommentError('INVALID_TASK_COMMENT'); };
  if (!input || !isCoManagedUuid(input.operationId) || !['create', 'edit', 'delete'].includes(input.kind)) invalid();
  const allowed = input.kind === 'create' ? ['operationId', 'kind', 'text', 'document', 'audience', 'parent', 'expectedAudience'] :
    input.kind === 'edit' ? ['operationId', 'kind', 'text', 'document', 'comment', 'expectedRevision'] : ['operationId', 'kind', 'comment', 'expectedRevision'];
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid();
  const reference = (ref: CoManagedCommentReference) => {
    if (!ref || ![ref.storeTenant, ref.threadId, ref.commentId].every(isCoManagedUuid) || Object.keys(ref).some(key => !['storeTenant', 'threadId', 'commentId'].includes(key))) invalid();
    return { storeTenant: ref.storeTenant.toLowerCase(), threadId: ref.threadId.toLowerCase(), commentId: ref.commentId.toLowerCase() };
  };
  const content = () => { try { return snapshotConversationContent(input as any); } catch { return invalid(); } };
  const operationId = input.operationId.toLowerCase();
  if (input.kind === 'create') {
    if (input.parent) {
      if (input.audience !== undefined || (input.expectedAudience !== undefined && !audienceNames.includes(input.expectedAudience))) invalid();
      return { kind: 'create', operationId, ...content(), parent: reference(input.parent), ...(input.expectedAudience !== undefined ? { expectedAudience: input.expectedAudience } : {}) };
    }
    if (!audienceNames.includes(input.audience!) || input.expectedAudience !== undefined || input.parent !== undefined) invalid();
    return { kind: 'create', operationId, ...content(), audience: input.audience };
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647) invalid();
  const base = { operationId, comment: reference(input.comment), expectedRevision: input.expectedRevision };
  return input.kind === 'edit' ? { ...base, kind: 'edit', ...content() } : { ...base, kind: 'delete' };
}
export async function mutateCoManagedProjectTaskComment(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, input: CoManagedTaskCommentCommand) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), request = commandSnapshot(input), foreign = actor.tenant !== resource.tenant;
  const target = request.kind === 'create' ? request.parent : request.comment;
  if (foreign && ((request.kind === 'create' && request.audience === 'organization_private') || target?.storeTenant === actor.tenant)) {
    if (request.kind === 'create' && request.expectedAudience !== undefined && request.expectedAudience !== 'organization_private') deny();
    const { audience: _audience, expectedAudience: _expected, ...privateRequest } = request as any;
    return mutateCoManagedPrivateTaskComment(db, actor, resource, privateRequest);
  }
  if (target && target.storeTenant !== resource.tenant) deny();
  const hash = createHash('sha256').update(JSON.stringify({ actor: { tenant: actor.tenant, userId: actor.userId }, resource, command: 'project_task_comment', request })).digest('hex');
  const withWork = boundary(actor, resource);
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    if (isCoManagedReadFieldHidden([...write.redactedFields, ...read.redactedFields], [...bodySources, 'revision'])) deny();
    const owner = tenantDb(write.trx, resource.tenant), threadId = target?.threadId ?? request.operationId, commentId = request.kind === 'create' ? request.operationId : request.comment.commentId;
    const revision = request.kind === 'create' ? 1 : request.expectedRevision + 1;
    const receipt = (at: string | Date) => ({ operationId: request.operationId, storeTenant: resource.tenant, threadId, commentId, revision, appliedAt: new Date(at).toISOString() });
    const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
    if (previous) { if (previous.request_hash !== hash) throw new CoManagedTaskCommentError('TASK_COMMENT_OPERATION_CONFLICT'); await current(write, true); return receipt(previous.applied_at); }
    let audience = request.kind === 'create' ? request.audience : undefined;
    if (target) {
      const thread = await owner.table('comment_threads').where({ thread_id: threadId, project_task_id: resource.id }).whereNull('ticket_id').forUpdate().first();
      if (!thread) deny(); audience = audienceOf(thread);
      if (foreign && audience === 'organization_private') deny();
      const root = await owner.table('project_task_comments').where({ task_comment_id: thread.root_comment_id, task_id: resource.id, thread_id: threadId }).forShare().first();
      if (!root || (request.kind === 'create' && root.deleted_at)) deny();
      if (request.kind === 'create' && request.expectedAudience !== undefined && request.expectedAudience !== audience) deny();
    }
    if (!audience) deny();
    if (request.kind === 'create') {
      if (target && !await owner.table('project_task_comments').where({ task_comment_id: target.commentId, task_id: resource.id, thread_id: threadId }).whereNull('deleted_at').forShare().first()) deny();
      const referenceId = foreign ? await ensureCoManagedActorReference(write) : null;
      const user = await tenantDb(write.trx, actor.tenant).table('users').where('user_id', actor.userId).forShare().first('first_name', 'last_name', 'email');
      const organization = await tenantDb(write.trx, actor.tenant).table('tenants').forShare().first('client_name');
      await current(write, true);
      if (!target) await owner.table('comment_threads').insert({ tenant: resource.tenant, thread_id: threadId, project_task_id: resource.id, ticket_id: null,
        root_comment_id: commentId, is_internal: audience !== 'requester', collaboration_audience: audience, created_by: foreign ? null : actor.userId,
        reply_count: 0, created_at: write.trx.raw('clock_timestamp()'), last_activity_at: write.trx.raw('clock_timestamp()') });
      await owner.table('project_task_comments').insert({ tenant: resource.tenant, task_comment_id: commentId, task_id: resource.id, thread_id: threadId,
        parent_comment_id: target?.commentId ?? null, user_id: foreign ? null : actor.userId, author_type: 'internal', actor_reference_id: referenceId,
        actor_display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || actor.userId,
        actor_organization_name: organization.client_name || actor.tenant, ...encodeConversationContent(request), collaboration_revision: 1,
        created_at: write.trx.raw('clock_timestamp()'), updated_at: write.trx.raw('clock_timestamp()') });
    } else {
      const comment = await owner.table('project_task_comments').where({ task_comment_id: commentId, task_id: resource.id, thread_id: threadId }).forUpdate().first();
      if (!comment) deny();
      const reference = comment.actor_reference_id ? await owner.table('collaboration_actor_references').where('actor_reference_id', comment.actor_reference_id).forShare().first('actor_tenant', 'actor_user_id') : null;
      if (reference ? reference.actor_tenant !== actor.tenant || reference.actor_user_id !== actor.userId : foreign || comment.user_id !== actor.userId) deny();
      if (comment.deleted_at || comment.collaboration_revision !== request.expectedRevision) throw new CoManagedTaskCommentError('TASK_COMMENT_CONFLICT');
      await current(write, true);
      await owner.table('project_task_comments').where('task_comment_id', commentId).update({ collaboration_revision: revision,
        updated_at: write.trx.raw('clock_timestamp()'), ...(request.kind === 'edit' ? { ...encodeConversationContent(request), edited_at: write.trx.raw('clock_timestamp()') } : { deleted_at: write.trx.raw('clock_timestamp()') }) });
    }
    await owner.table('comment_threads').where('thread_id', threadId).update({ last_activity_at: write.trx.raw('clock_timestamp()'),
      ...(request.kind === 'create' && target ? { reply_count: write.trx.raw('reply_count + 1') } : {}) });
    await retainCoManagedTaskCommentEvent(write.trx, { tenant: resource.tenant, eventId: request.operationId, taskId: resource.id, commentId, kind: request.kind });
    await current(write, true);
    const [saved] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId,
      relationship_id: resource.relationshipId, resource_type: 'project_task', resource_id: resource.id, actor_tenant: actor.tenant, actor_user_id: actor.userId,
      command_type: `task_comment_${request.kind}`, request_hash: hash, applied_at: write.trx.raw('clock_timestamp()') }).returning('applied_at');
    return receipt(saved.applied_at);
  })); } catch (error) {
    if ((error as any)?.code === '23505' && ['co_management_command_receipts_pkey', 'project_task_comments_pkey', 'comment_threads_pkey'].includes((error as any)?.constraint)) throw new CoManagedTaskCommentError('TASK_COMMENT_OPERATION_CONFLICT');
    throw error;
  }
}

function timestamp(trx: Knex.Transaction, column: string) {
  return trx.raw(`to_char(?? AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, [column]);
}
// LEVERAGE: pattern qualified-conversation-page — ticket and task readers combine canonical and home-private stores with exact composite cursors.
export async function getCoManagedProjectTaskConversation(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, before?: CoManagedConversationCursor) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), foreign = actor.tenant !== resource.tenant;
  if (before && (!isCoManagedUuid(before.storeTenant) || !isCoManagedUuid(before.commentId) || typeof before.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(before.createdAt) || !Number.isFinite(Date.parse(before.createdAt)))) deny();
  const cursor = before ? { createdAt: before.createdAt, storeTenant: before.storeTenant.toLowerCase(), commentId: before.commentId.toLowerCase() } : undefined;
  return boundary(actor, resource)(db, actor, resource, 'read', async context => {
    const { trx, redactedFields } = context, queries: Knex.QueryBuilder[] = [];
    const hideCanonical = isCoManagedReadFieldHidden(redactedFields, bodySources);
    const hidePrivate = isCoManagedReadFieldHidden(redactedFields, [...coManagedConversationBodySources, 'co_management_private_threads', 'co_management_private_comments']);
    if (!hideCanonical) {
      const owner = tenantDb(trx, resource.tenant), query = owner.table('project_task_comments as c').where('c.task_id', resource.id);
      owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.project_task_id', '=', 'c.task_id').andOnNull('t.ticket_id') });
      owner.tenantJoin(query, 'project_task_comments as root', 't.root_comment_id', 'root.task_comment_id', { on: join => join.andOn('root.task_id', '=', 'c.task_id').andOn('root.thread_id', '=', 'c.thread_id') });
      owner.tenantJoin(query, 'project_task_comments as parent', 'c.parent_comment_id', 'parent.task_comment_id', { type: 'left', on: join => join.andOn('parent.task_id', '=', 'c.task_id').andOn('parent.thread_id', '=', 'c.thread_id') });
      owner.tenantJoin(query, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id', { type: 'left' });
      owner.tenantJoin(query, 'users as u', 'c.user_id', 'u.user_id', { type: 'left' });
      const audience = projectTaskAudienceSql(trx, 't'), organization = await owner.table('tenants').first('client_name');
      if (foreign) query.whereRaw('? IN (?, ?)', [audience, 'requester', 'shared_it']);
      query.select({ store_tenant: 'c.tenant', comment_id: 'c.task_comment_id', thread_id: 'c.thread_id', parent_comment_id: 'parent.task_comment_id', audience,
        created_at: 'c.created_at', created_at_exact: timestamp(trx, 'c.created_at'), updated_at_exact: timestamp(trx, 'c.updated_at'),
        root_deleted_at: 'root.deleted_at', deleted_at: 'c.deleted_at', note: 'c.note', markdown: 'c.markdown_content', revision: 'c.collaboration_revision',
        actor_tenant: trx.raw('COALESCE(a.actor_tenant, c.tenant)'), actor_id: trx.raw('COALESCE(a.actor_user_id, c.user_id)'), actor_reference_id: 'c.actor_reference_id',
        actor_display_name: trx.raw("COALESCE(c.actor_display_name, NULLIF(CONCAT_WS(' ', u.first_name, u.last_name), ''), u.email)"),
        actor_organization_name: trx.raw('COALESCE(c.actor_organization_name, ?::text)', [organization?.client_name ?? null]) });
      queries.push(query);
    }
    if (foreign && !hidePrivate) {
      const home = tenantDb(trx, actor.tenant), query = home.table('co_management_private_comments as c');
      home.tenantJoin(query, 'co_management_private_threads as t', 'c.thread_id', 't.thread_id');
      home.tenantJoin(query, 'co_management_private_comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 'c.thread_id') });
      home.tenantJoin(query, 'co_management_private_comments as parent', 'c.parent_comment_id', 'parent.comment_id', { type: 'left', on: join => join.andOn('parent.thread_id', '=', 'c.thread_id') });
      query.where({ 't.customer_tenant': resource.tenant, 't.relationship_id': resource.relationshipId, 't.resource_type': 'project_task', 't.resource_id': resource.id }).whereNull('t.disclosure_operation_id');
      query.select({ store_tenant: 'c.tenant', comment_id: 'c.comment_id', thread_id: 'c.thread_id', parent_comment_id: 'parent.comment_id', audience: trx.raw("'organization_private'::text"),
        created_at: 'c.created_at', created_at_exact: timestamp(trx, 'c.created_at'), updated_at_exact: timestamp(trx, 'c.updated_at'), root_deleted_at: 'root.deleted_at', deleted_at: 'c.deleted_at', note: 'c.note', markdown: 'c.markdown_content',
        revision: 'c.revision', actor_tenant: 'c.tenant', actor_id: 'c.actor_user_id', actor_reference_id: trx.raw('NULL::uuid'), actor_display_name: 'c.actor_display_name', actor_organization_name: 'c.actor_organization_name' });
      queries.push(query);
    }
    if (!queries.length) { await current(context); return { resource, items: [] as CoManagedTaskConversationItem[], nextBefore: null }; }
    const query = trx.from(trx.queryBuilder().unionAll(queries, true).as('conversation')).orderBy('created_at', 'desc').orderBy('store_tenant', 'desc').orderBy('comment_id', 'desc').limit(26);
    if (cursor) query.whereRaw('(created_at, store_tenant, comment_id) < (?::timestamptz, ?::uuid, ?::uuid)', [cursor.createdAt, cursor.storeTenant, cursor.commentId]);
    const rows = await query; await current(context);
    const hideAuthor = isCoManagedReadFieldHidden(redactedFields, coManagedConversationAuthorSources), hideRevision = isCoManagedReadFieldHidden(redactedFields, ['revision']);
    const items: CoManagedTaskConversationItem[] = rows.slice(0, 25).map(row => ({ storeTenant: row.store_tenant, commentId: row.comment_id, threadId: row.thread_id, parentCommentId: row.parent_comment_id,
      canReply: row.deleted_at == null && row.root_deleted_at == null && !hideRevision, audience: row.audience, createdAt: row.created_at_exact, updatedAt: row.updated_at_exact, deleted: row.deleted_at != null, revision: hideRevision ? null : row.revision,
      note: row.deleted_at ? null : row.note, markdown: row.deleted_at ? null : row.markdown,
      ...(hideAuthor ? {} : { author: { tenant: row.actor_tenant, kind: 'user' as const, id: row.actor_id, displayName: row.actor_display_name, organizationName: row.actor_organization_name, referenceId: row.actor_reference_id } }) }));
    const last = items.at(-1);
    return { resource, items, nextBefore: rows.length > 25 && last ? { createdAt: last.createdAt, storeTenant: last.storeTenant, commentId: last.commentId } : null };
  });
}
export async function getCoManagedProjectTaskWriteAudiences(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource): Promise<CommentAudience[]> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), withWork = boundary(actor, resource);
  try { return await withWork(db, actor, resource, 'update', write => withWork(write.trx, actor, resource, 'read', async read => {
    const redactions = [...write.redactedFields, ...read.redactedFields], hidden = (names: readonly string[]) => isCoManagedReadFieldHidden(redactions, names);
    const canonical = hidden([...bodySources, 'revision']), privateNotes = hidden([...coManagedConversationBodySources, 'co_management_private_threads', 'co_management_private_comments', 'revision']);
    await current(write, true);
    return [...(canonical ? [] : ['requester', 'shared_it']), ...((actor.tenant === resource.tenant ? canonical : privateNotes) ? [] : ['organization_private'])] as CommentAudience[];
  })); } catch (error) { if (error instanceof CoManagedSharedWorkError || isCoManagedLifecycleError(error)) return []; throw error; }
}
