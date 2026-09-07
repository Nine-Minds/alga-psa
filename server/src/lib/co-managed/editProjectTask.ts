import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ProjectTaskModel } from '@alga-psa/projects/models';
import { editCoManagedProjectTask, type CoManagedSessionActor, type CoManagedSharedResource, type CoManagedTaskEditRequest } from '@alga-psa/co-managed';

/** Uses the existing owner-local task model under qualified collaboration authority. */
export async function editSharedProjectTask(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedTaskEditRequest) {
  const operationId = request.operationId;
  return editCoManagedProjectTask(db, actor, resource, request, async (context, patch, actorReferenceId) => {
    await ProjectTaskModel.updateTask(context.trx, context.resource.tenant, context.resource.id, patch as any);
    const reference = actorReferenceId ? await tenantDb(context.trx, context.resource.tenant).table('collaboration_actor_references')
      .where('actor_reference_id', actorReferenceId).forShare().first('display_name', 'organization_name') : null;
    const user = reference ? null : await tenantDb(context.trx, context.actor.tenant).table('users').where('user_id', context.actor.userId)
      .forShare().first('first_name', 'last_name', 'email');
    const organization = reference ? null : await tenantDb(context.trx, context.actor.tenant).table('tenants').forShare().first('client_name');
    const displayName = reference?.display_name ?? ([user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || context.actor.userId);
    await tenantDb(context.trx, context.resource.tenant).table('audit_logs').insert({ audit_id: randomUUID(), tenant: context.resource.tenant,
      table_name: 'project_tasks', record_id: context.resource.id, operation: 'co_managed_project_task_update', changed_data: patch,
      user_id: actorReferenceId ? null : context.actor.userId, timestamp: context.trx.raw('clock_timestamp()'),
      details: { actor_reference_id: actorReferenceId, actor_display_name: displayName, actor_organization_name: reference?.organization_name ?? organization?.client_name, actor_tenant: context.actor.tenant, actor_user_id: context.actor.userId, relationship_id: context.resource.relationshipId,
        operation_id: operationId } });
  });
}
