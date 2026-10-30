import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSharedResource } from './sharedWork';
import { coManagedAssigneeOption, type CoManagedAssignee } from './sharedWorkAssignees';
import { snapshotCoManagedSessionActor, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { CoManagedTaskEditError } from './projectTaskEditing';
import { readCoManagedCustomerOrganizationName } from './projectTaskQueue';
import { assertCoManagedProjectWorkServed } from './projectTaskGate';
import { coManagedRequestHash, findCoManagedTaskReplay, recordCoManagedTaskAudit } from './projectTaskAudit';

export interface CoManagedTaskAssignmentRequest {
  assignee: { kind: 'user' | 'team'; id: string };
  /** The reference `revision` the caller loaded; omit (null) to create the reference. */
  expectedRevision: number | null;
  /** Client-generated per submit attempt; a repeat of the same id replays the original receipt. */
  operationId?: string;
}
export interface CoManagedTaskAssignmentReceipt { referenceId: string; revision: number; assigneeName: string }

/**
 * Assign a shared task to MSP staff. The assignee is written ONLY to the MSP-owned reference row
 * (`co_managed_project_task_references.assigned_to | assigned_team_id`). The customer's
 * `project_tasks.assigned_to` and `task_resources` are never read for write or touched here:
 * two assignees from two organisations, one task.
 */
export async function assignCoManagedProjectTask(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  request: CoManagedTaskAssignmentRequest): Promise<CoManagedTaskAssignmentReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!inputResource || inputResource.kind !== 'project_task' || ![inputResource.tenant, inputResource.id, inputResource.relationshipId].every(isCoManagedUuid) ||
      !request || !['user', 'team'].includes(request.assignee?.kind) || !isCoManagedUuid(request.assignee?.id) ||
      !(request.expectedRevision === null || (Number.isInteger(request.expectedRevision) && request.expectedRevision > 0)) ||
      (request.operationId !== undefined && !isCoManagedUuid(request.operationId))) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'project_task', tenant: inputResource.tenant.toLowerCase(), id: inputResource.id.toLowerCase(), relationshipId: inputResource.relationshipId.toLowerCase() };
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, resource, 'update', async context => {
    const { trx } = context, home = tenantDb(trx, actor.tenant), customer = tenantDb(trx, resource.tenant);
    const assignee: CoManagedAssignee = { tenant: actor.tenant, kind: request.assignee.kind, id: request.assignee.id.toLowerCase() };
    // The proposed assignee must pass the same access matrix as an acting technician.
    const option = await coManagedAssigneeOption(context, assignee, { hidden: fields => isCoManagedReadFieldHidden(context.redactedFields, fields) });
    const relationship = await customer.table('co_management_relationships').where({ relationship_id: resource.relationshipId, sponsor_tenant: actor.tenant }).first('sponsor_client_id');
    if (!relationship) throw new CoManagedSharedWorkError();
    const taskQuery = customer.table('project_tasks as task').where('task.task_id', resource.id);
    customer.tenantJoin(taskQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    customer.tenantJoin(taskQuery, 'projects as project', 'phase.project_id', 'project.project_id');
    const task = await taskQuery.first('task.task_name', 'project.project_name');
    if (!task) throw new CoManagedSharedWorkError();
    // A redacted name is stored as empty, never inferred from a sibling column.
    const taskName = isCoManagedReadFieldHidden(context.redactedFields, ['task_name', 'values.task_name', 'project_tasks.task_name']) ? '' : task.task_name;
    const projectName = isCoManagedReadFieldHidden(context.redactedFields, ['project', 'projectName', 'project_name', 'projects.project_name']) ? '' : task.project_name;
    const assignedColumns = { assigned_to: assignee.kind === 'user' ? assignee.id : null, assigned_team_id: assignee.kind === 'team' ? assignee.id : null };
    const snapshots = { assignee_name: option.name, organization_name: await readCoManagedCustomerOrganizationName(trx, resource.tenant, context.redactedFields), task_name: taskName, project_name: projectName };
    const existing = await home.table('co_managed_project_task_references')
      .where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, task_id: resource.id }).forUpdate().first();
    const requestHash = coManagedRequestHash('task_assignment', resource, { assignee: { kind: assignee.kind, id: assignee.id }, expectedRevision: request.expectedRevision });
    const operationId = request.operationId?.toLowerCase() ?? randomUUID();
    if (request.operationId) {
      const replay = await findCoManagedTaskReplay<CoManagedTaskAssignmentReceipt>(context, operationId, requestHash);
      if (replay) return replay;
    }
    const audit = async (receipt: CoManagedTaskAssignmentReceipt) => {
      await recordCoManagedTaskAudit(context, { operation: 'co_managed_project_task_assignment', operationId, requestHash,
        changes: { msp_assignee: { from: existing ? (existing.assigned_to ?? existing.assigned_team_id) : null, to: assignee.id, kind: assignee.kind, name: option.name } }, receipt });
      return receipt;
    };
    if (!existing) {
      if (request.expectedRevision !== null) throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT', 'revision');
      const referenceId = randomUUID();
      // A concurrent first assignment has no row to lock, so both callers reach this insert. ON CONFLICT DO NOTHING waits
      // for the winner to commit and then inserts nothing, instead of raising a unique violation that would abort the transaction.
      // write-admission: exempt — MSP-owned participation reference (no customer data), written under the reference-row lock inside L2 admission (withCoManagedSharedWork 'update')
      const inserted = await home.table('co_managed_project_task_references').insert({ tenant: actor.tenant, reference_id: referenceId, customer_tenant: resource.tenant,
        relationship_id: resource.relationshipId, task_id: resource.id, client_id: relationship.sponsor_client_id, active: true, revision: 1, ...assignedColumns, ...snapshots })
        .onConflict(['tenant', 'customer_tenant', 'relationship_id', 'task_id']).ignore().returning('reference_id');
      if (inserted.length === 0) {
        // Lost the race: the winner's row and audit entry are committed. Same operation id and request replays its receipt;
        // anything else is a stale first-assignment, i.e. the normal revision conflict.
        if (request.operationId) {
          const replay = await findCoManagedTaskReplay<CoManagedTaskAssignmentReceipt>(context, operationId, requestHash);
          if (replay) return replay;
        }
        throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT', 'revision');
      }
      const receipt = await audit({ referenceId, revision: 1, assigneeName: option.name });
      await context.assertCurrent();
      return receipt;
    }
    if (existing.revision !== request.expectedRevision) throw new CoManagedTaskEditError('TASK_EDIT_CONFLICT', 'revision');
    const revision = existing.revision + 1;
    // write-admission: exempt — MSP-owned participation reference (no customer data), written under the reference-row lock inside L2 admission (withCoManagedSharedWork 'update')
    await home.table('co_managed_project_task_references').where({ reference_id: existing.reference_id })
      .update({ active: true, revision, updated_at: trx.fn.now(), ...assignedColumns, ...snapshots });
    const receipt = await audit({ referenceId: existing.reference_id, revision, assigneeName: option.name });
    await context.assertCurrent();
    return receipt;
  });
}
