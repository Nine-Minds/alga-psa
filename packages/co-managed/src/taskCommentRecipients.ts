import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import type { CoManagedSharedResource, CoManagedNotificationRecipientContext } from './sharedWork';
import { withCoManagedTaskCommentNotification, type CoManagedTaskCommentNotification } from './taskCommentNotification';

async function routing(db: Knex, resource: CoManagedSharedResource, tenant: string, lock = false) {
  const home = tenantDb(db, tenant);
  const query = tenant === resource.tenant ? home.table('project_tasks').where('task_id', resource.id)
    : home.table('co_managed_project_task_references').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, task_id: resource.id, active: true });
  if (tenant !== resource.tenant) {
    const relationship = await tenantDb(db, resource.tenant).table('co_management_relationships').where({ relationship_id: resource.relationshipId, sponsor_tenant: tenant, state: 'active' }).whereNull('ended_at').first('sponsor_client_id');
    if (!relationship) return null;
    query.where('client_id', relationship.sponsor_client_id);
  }
  if (lock) query.forShare();
  return query.first('assigned_to', 'assigned_team_id');
}

/** Routing supplies candidates; current project authority remains mandatory. */
export async function isCoManagedTaskNotificationAssignee(context: CoManagedNotificationRecipientContext): Promise<boolean> {
  const { trx, resource, actor } = context, home = tenantDb(trx, actor.tenant), current = await routing(trx, resource, actor.tenant, true);
  if (!current) return false;
  if (current.assigned_to === actor.userId) return true;
  if (current.assigned_team_id && await home.table('team_members').where({ team_id: current.assigned_team_id, user_id: actor.userId }).forShare().first()) return true;
  return actor.tenant === resource.tenant && Boolean(await home.table('task_resources').where({ task_id: resource.id, additional_user_id: actor.userId }).forShare().first());
}

export async function deliverCoManagedTaskCommentToAssignees(db: Knex, input: { ownerTenant: string; taskId: string; commentId: string; eventId: string; channel: 'in_app' | 'email' },
  deliver: (context: CoManagedNotificationRecipientContext, message: CoManagedTaskCommentNotification, deliveryKey: string) => Promise<void>): Promise<void> {
  if (!input || ![input.ownerTenant, input.taskId, input.commentId, input.eventId].every(isCoManagedUuid) || !['in_app', 'email'].includes(input.channel)) throw new CoManagedSharedWorkError();
  const request = { ownerTenant: input.ownerTenant.toLowerCase(), taskId: input.taskId.toLowerCase(), commentId: input.commentId.toLowerCase(), eventId: input.eventId.toLowerCase(), channel: input.channel }, owner = tenantDb(db, request.ownerTenant);
  const relationship = await owner.table('co_management_relationships').first('relationship_id', 'sponsor_tenant', 'state', 'ended_at');
  if (!relationship) return;
  const resource: CoManagedSharedResource = { tenant: request.ownerTenant, relationshipId: relationship.relationship_id, kind: 'project_task', id: request.taskId };
  // Foreign admission acquires sponsor/lifecycle locks before owner resources.
  const tenants = [...(relationship.state === 'active' && !relationship.ended_at ? [relationship.sponsor_tenant] : []), request.ownerTenant];
  const failures: unknown[] = [];
  for (const tenant of tenants) {
    const home = tenantDb(db, tenant), current = await routing(db, resource, tenant);
    if (!current) continue;
    const candidates = await home.table('users').where({ user_type: 'internal', is_inactive: false }).where(query => {
      query.whereRaw('false');
      if (current.assigned_to) query.orWhere('user_id', current.assigned_to);
      if (current.assigned_team_id) query.orWhereIn('user_id', home.table('team_members').where('team_id', current.assigned_team_id).select('user_id'));
      if (tenant === resource.tenant) query.orWhereIn('user_id', home.table('task_resources').where('task_id', resource.id).select('additional_user_id'));
    }).orderBy('user_id').select('user_id');
    for (const candidate of candidates) try {
      await withCoManagedTaskCommentNotification(db, { kind: 'notification_recipient', tenant, userId: candidate.user_id }, resource, request.commentId, async (context, message) => {
        if (!await isCoManagedTaskNotificationAssignee(context)) return;
        await deliver(context, message, `co-managed-task-comment:${resource.tenant}:${resource.id}:${request.commentId}:${request.eventId}:${request.channel}:${tenant}:${candidate.user_id}`);
      });
    } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Task comment delivery failed for one or more recipients');
}
