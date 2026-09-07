import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { coManagedConversationBodySources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Scheduling commands belong to the current technician. Publication separately
 * re-admits the original author, so a departed author cannot block cancellation. */
export async function admitCoManagedScheduledCommentCommand(trx: Knex.Transaction, inputActor: CoManagedSessionActor,
  input: { commentId: string; ticketId: string; operation: 'create' | 'reschedule' | 'cancel' }): Promise<() => Promise<void>> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!['create', 'reschedule', 'cancel'].includes(input.operation) || !trx.isTransaction || ![input.commentId, input.ticketId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const assertCurrent = async () => { await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, actor.tenant); };
  await assertCoManagedOperationalWrite(trx, actor.tenant);
  const owner = tenantDb(trx, actor.tenant);
  const tenant = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedSessionIdentity(trx, actor);
  const ticket = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!ticket) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern customer-ticket-policy-record — schedule editors use current record scope independently from the original author.
  const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
    assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
  for (const action of ['read', 'update'] as const) {
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
    if (isCoManagedReadFieldHidden(decision.redactedFields, [...coManagedConversationBodySources, 'comments', 'comment_threads', 'comment_id',
      'scheduled_publish_at', 'scheduled_publish_tz', 'publish_state'])) throw new CoManagedSharedWorkError();
  }
  const locator = await owner.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId }).first('thread_id');
  if (!locator?.thread_id || !await owner.table('comment_threads').where({ thread_id: locator.thread_id, ticket_id: input.ticketId }).forUpdate().first()) throw new CoManagedSharedWorkError();
  const query = owner.table('comments as c').where({ 'c.comment_id': input.commentId, 'c.ticket_id': input.ticketId, 'c.thread_id': locator.thread_id });
  owner.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id');
  owner.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', { on: join => join.andOn('root.thread_id', '=', 't.thread_id').andOn('root.ticket_id', '=', 't.ticket_id') });
  const source = await query.forUpdate('c', 't', 'root').select('c.*', 'root.publish_state as root_state', 'root.deleted_at as root_deleted_at', { audience: commentAudienceSql(trx, 't', 'root', 'c') }).first();
  if (!source || source.publish_state !== 'scheduled' || source.deleted_at || source.author_type !== 'internal' || !source.user_id || source.actor_reference_id ||
      source.contact_id || source.is_system_generated || source.audience !== 'requester' || (input.operation === 'create' && source.user_id !== actor.userId) ||
      (input.operation !== 'cancel' && source.parent_comment_id && (source.root_state !== 'published' || source.root_deleted_at))) throw new CoManagedSharedWorkError();
  await assertCurrent();
  return assertCurrent;
}
