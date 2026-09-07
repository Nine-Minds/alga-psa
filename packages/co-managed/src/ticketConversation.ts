import type { Knex } from 'knex';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { coManagedConversationBodySources as historySources, coManagedConversationAuthorSources as authorSources, coManagedConversationAttachmentSources } from './conversationPolicy';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { snapshotCoManagedSessionActor, isCoManagedUuid, assertCoManagedSessionUnexpired, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedConversationCursor { createdAt: string; storeTenant: string; commentId: string }
export interface CoManagedConversationAuthor {
  tenant: string;
  kind: 'user' | 'contact' | 'system' | 'unknown';
  id: string | null;
  displayName: string | null;
  organizationName: string | null;
  referenceId: string | null;
}
export interface CoManagedConversationItem {
  /** Store owner is distinct from the ticket owner for MSP-private content. */
  storeTenant: string;
  commentId: string;
  threadId: string;
  parentCommentId: string | null;
  audience: CommentAudience;
  createdAt: string;
  updatedAt: string | null;
  deleted: boolean;
  revision: number | null;
  note: string | null;
  markdown: string | null;
  author?: CoManagedConversationAuthor;
}
export interface CoManagedTicketConversation {
  resource: CoManagedSharedResource;
  items: CoManagedConversationItem[];
  nextBefore: CoManagedConversationCursor | null;
}
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
function snapshotCursor(input?: CoManagedConversationCursor): CoManagedConversationCursor | undefined {
  if (input === undefined) return undefined;
  if (!input || !isCoManagedUuid(input.storeTenant) || !isCoManagedUuid(input.commentId) || typeof input.createdAt !== 'string' ||
      !iso.test(input.createdAt) || !Number.isFinite(Date.parse(input.createdAt))) throw new CoManagedSharedWorkError();
  return { storeTenant: input.storeTenant.toLowerCase(), commentId: input.commentId.toLowerCase(), createdAt: input.createdAt };
}
function timestamp(trx: Knex.Transaction, column: string) {
  // Preserve microseconds so a cursor cannot skip comments created in the same millisecond.
  return trx.raw(`to_char(?? AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, [column]);
}
async function readConversation(context: CoManagedSharedWorkContext, cursor?: CoManagedConversationCursor): Promise<CoManagedTicketConversation> {
  const { trx, actor, resource, redactedFields } = context;
  const foreign = actor.tenant !== resource.tenant;
  const hideCustomer = isCoManagedReadFieldHidden(redactedFields, [...historySources, 'comments', 'comment_threads']);
  const hidePrivate = isCoManagedReadFieldHidden(redactedFields, [...historySources, 'co_management_private_threads', 'co_management_private_comments']);
  if (hideCustomer && (!foreign || hidePrivate)) return { resource, items: [], nextBefore: null };
  const customer = tenantDb(trx, resource.tenant);
  const customerName = (await customer.table('tenants').first('client_name')).client_name;
  const comments = customer.table('comments as c').where('c.ticket_id', resource.id).where('c.publish_state', 'published');
  customer.tenantJoin(comments, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
  customer.tenantJoin(comments, 'comments as root', 't.root_comment_id', 'root.comment_id', {
    on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id') });
  comments.where('root.publish_state', 'published');
  const audience = commentAudienceSql(trx, 't', 'root', 'c');
  if (foreign) comments.whereRaw('? IN (?, ?)', [audience, 'requester', 'shared_it']);
  customer.tenantJoin(comments, 'comments as parent', 'c.parent_comment_id', 'parent.comment_id', { type: 'left',
    on: join => join.andOn('parent.thread_id', '=', 't.thread_id').andOn('parent.ticket_id', '=', 'c.ticket_id') });
  customer.tenantJoin(comments, 'collaboration_actor_references as a', 'c.actor_reference_id', 'a.actor_reference_id', { type: 'left' });
  customer.tenantJoin(comments, 'users as u', 'c.user_id', 'u.user_id', { type: 'left' });
  customer.tenantJoin(comments, 'contacts as contact', 'c.contact_id', 'contact.contact_name_id', { type: 'left' });
  const parentAudience = commentAudienceSql(trx, 't', 'root', 'parent');
  comments.select({ store_tenant: 'c.tenant', comment_id: 'c.comment_id', thread_id: 'c.thread_id',
    parent_comment_id: trx.raw(`CASE WHEN parent.publish_state = 'published' AND (? = false OR ? IN ('requester', 'shared_it')) THEN parent.comment_id ELSE NULL END`, [foreign, parentAudience]),
    audience, created_at: 'c.created_at', created_at_exact: timestamp(trx, 'c.created_at'), updated_at_exact: timestamp(trx, 'c.updated_at'),
    deleted_at: 'c.deleted_at', note: 'c.note', markdown: 'c.markdown_content', revision: trx.raw('NULL::integer'),
    actor_tenant: trx.raw('COALESCE(a.actor_tenant, c.tenant)'),
    actor_kind: trx.raw("CASE WHEN c.actor_reference_id IS NOT NULL OR c.user_id IS NOT NULL THEN 'user' WHEN c.contact_id IS NOT NULL THEN 'contact' WHEN c.is_system_generated THEN 'system' ELSE 'unknown' END"),
    actor_id: trx.raw('COALESCE(a.actor_user_id, c.user_id, c.contact_id)'), actor_reference_id: 'c.actor_reference_id',
    actor_display_name: trx.raw("CASE WHEN c.actor_reference_id IS NOT NULL THEN c.actor_display_name ELSE COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), contact.full_name) END"),
    actor_organization_name: trx.raw('CASE WHEN c.actor_reference_id IS NOT NULL THEN c.actor_organization_name ELSE ?::text END', [customerName]),
  });
  const queries = hideCustomer ? [] : [comments];
  if (foreign && !hidePrivate) {
    // Only the caller's own store enters the union. Ticket ownership or customer
    // administration never selects the sponsor's private content for a customer.
    const home = tenantDb(trx, actor.tenant);
    const privateComments = home.table('co_management_private_comments as c');
    home.tenantJoin(privateComments, 'co_management_private_threads as t', 'c.thread_id', 't.thread_id');
    privateComments.where({ 't.customer_tenant': resource.tenant, 't.relationship_id': resource.relationshipId, 't.resource_type': 'ticket', 't.resource_id': resource.id }).whereNull('t.disclosure_operation_id');
    home.tenantJoin(privateComments, 'co_management_private_comments as parent', 'c.parent_comment_id', 'parent.comment_id', { type: 'left',
      on: join => join.andOn('parent.thread_id', '=', 'c.thread_id') });
    privateComments.select({ store_tenant: 'c.tenant', comment_id: 'c.comment_id', thread_id: 'c.thread_id', parent_comment_id: 'parent.comment_id',
      audience: trx.raw("'organization_private'::text"), created_at: 'c.created_at', created_at_exact: timestamp(trx, 'c.created_at'), updated_at_exact: timestamp(trx, 'c.updated_at'),
      deleted_at: 'c.deleted_at', note: 'c.note', markdown: 'c.markdown_content', revision: 'c.revision', actor_tenant: 'c.tenant', actor_kind: trx.raw("'user'::text"),
      actor_id: 'c.actor_user_id', actor_reference_id: trx.raw('NULL::uuid'), actor_display_name: 'c.actor_display_name', actor_organization_name: 'c.actor_organization_name' });
    queries.push(privateComments);
  }
  const query = trx.from(trx.queryBuilder().unionAll(queries, true).as('history')).orderBy('created_at', 'desc').orderBy('store_tenant', 'desc').orderBy('comment_id', 'desc').limit(26);
  if (cursor) query.whereRaw('(created_at, store_tenant, comment_id) < (?::timestamptz, ?::uuid, ?::uuid)', [cursor.createdAt, cursor.storeTenant, cursor.commentId]);
  const rows = await query;
  await assertCoManagedSessionUnexpired(trx, { ...actor, kind: 'session', sessionId: context.sessionId });
  const hideAuthor = isCoManagedReadFieldHidden(redactedFields, authorSources);
  const items: CoManagedConversationItem[] = rows.slice(0, 25).map(row => ({
    storeTenant: row.store_tenant, commentId: row.comment_id, threadId: row.thread_id, parentCommentId: row.parent_comment_id,
    audience: row.audience, createdAt: row.created_at_exact, updatedAt: row.updated_at_exact, deleted: row.deleted_at != null,
    revision: isCoManagedReadFieldHidden(redactedFields, ['revision']) ? null : row.revision,
    note: row.deleted_at == null ? row.note : null, markdown: row.deleted_at == null ? row.markdown : null,
    ...(hideAuthor ? {} : { author: { tenant: row.actor_tenant, kind: row.actor_kind, id: row.actor_id, displayName: row.actor_display_name,
      organizationName: row.actor_organization_name, referenceId: row.actor_reference_id } }),
  }));
  const last = items.at(-1);
  return { resource, items, nextBefore: rows.length > 25 && last ? { createdAt: last.createdAt, storeTenant: last.storeTenant, commentId: last.commentId } : null };
}

/** Published ticket conversation only. Caller adapters supply a verified home
 * session; every page repeats resource authority. Attachments require a separate
 * parent-audience download command, and metadata/email headers are never spread. */
export async function getCoManagedTicketConversation(db: Knex, inputActor: CoManagedSessionActor,
  inputResource: CoManagedSharedResource, before?: CoManagedConversationCursor): Promise<CoManagedTicketConversation> {
  const actor = snapshotCoManagedSessionActor(inputActor), cursor = snapshotCursor(before);
  if (!inputResource || inputResource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  return actor.tenant === inputResource.tenant
    ? withCoManagedCustomerTicket(db, actor, inputResource, 'read', context => readConversation(context, cursor))
    : withCoManagedSharedWork(db, actor, inputResource, 'read', context => readConversation(context, cursor));
}

/** Presentation hints only; every submission repeats command authorization.
 * Take update authority before read authority to avoid share-lock upgrades. */
export async function getCoManagedConversationContributionHints(db: Knex, inputActor: CoManagedSessionActor,
  resource: CoManagedSharedResource): Promise<{ writeAudiences: CommentAudience[]; attachmentAudiences: CommentAudience[] }> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  const foreign = actor.tenant !== resource.tenant;
  const authorize = foreign ? withCoManagedSharedWork : withCoManagedCustomerTicket;
  try {
    return await authorize(db, actor, resource, 'update', context => authorize(context.trx, actor, resource, 'read', async readContext => {
      const hidden = [...context.redactedFields, ...readContext.redactedFields];
      const customerHidden = isCoManagedReadFieldHidden(hidden, [...historySources, 'comments', 'comment_threads']);
      const privateHidden = isCoManagedReadFieldHidden(hidden, [...historySources, 'co_management_private_threads', 'co_management_private_comments', 'revision']);
      await assertCoManagedSessionUnexpired(context.trx, actor);
      const writeAudiences = [...(customerHidden ? [] : ['requester', 'shared_it']), ...((foreign ? privateHidden : customerHidden) ? [] : ['organization_private'])] as CommentAudience[];
      return { writeAudiences, attachmentAudiences: isCoManagedReadFieldHidden(hidden, [...coManagedConversationAttachmentSources, 'co_management_conversation_drafts']) ? [] : writeAudiences };
    }));
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError || error instanceof CoManagedLifecycleError) return { writeAudiences: [], attachmentAudiences: [] };
    throw error;
  }
}

export async function getCoManagedConversationWriteAudiences(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource): Promise<CommentAudience[]> {
  return (await getCoManagedConversationContributionHints(db, actor, resource)).writeAudiences;
}
