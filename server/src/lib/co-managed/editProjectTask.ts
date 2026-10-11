import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ProjectTaskModel } from '@alga-psa/projects/models';
import { recordCoManagedProjectTaskAudit, editCoManagedProjectTask, type CoManagedSessionActor, type CoManagedSharedResource, type CoManagedTaskEditRequest } from '@alga-psa/co-managed';

/** Uses the existing owner-local task model under qualified collaboration authority. */
export async function editSharedProjectTask(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedTaskEditRequest) {
  const operationId = request.operationId;
  return editCoManagedProjectTask(db, actor, resource, request, async (context, patch, actorReferenceId) => {
    await ProjectTaskModel.updateTask(context.trx, context.resource.tenant, context.resource.id, patch as any);
    const owner = tenantDb(context.trx, context.resource.tenant);
    const statusQuery = owner.table('project_status_mappings as mapping').where('mapping.project_status_mapping_id', patch.project_status_mapping_id ?? null);
    owner.tenantJoin(statusQuery, 'statuses as s', 'mapping.status_id', 's.status_id', { type: 'left' });
    owner.tenantJoin(statusQuery, 'standard_statuses as ss', 'mapping.standard_status_id', 'ss.standard_status_id', { type: 'left' });
    const status = patch.project_status_mapping_id ? await statusQuery.first(context.trx.raw('COALESCE(mapping.custom_name, s.name, ss.name) as name')) : null;
    await recordCoManagedProjectTaskAudit(context, { operation: 'co_managed_project_task_update', operationId,
      changes: patch, details: { task_status_name: status?.name }, actorReferenceId });
  });
}
