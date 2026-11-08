import { tenantDb } from '@alga-psa/db';
import type { CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { maskCoManagedSnapshot, coManagedTaskFieldAliases } from './sharedWorkProjection';

/** Only projected display fields leave this reader. Raw reference snapshots stay inside the admitted callback. */
export interface CoManagedProjectTaskReference {
  referenceId: string;
  revision: number;
  taskName: string | null;
  projectName: string | null;
  organizationName: string | null;
  assigneeName: string | null;
  /** Assignment existence is safe metadata required to distinguish hidden names from no assignment. */
  hasAssignment: boolean;
  assigneeKind: 'user' | 'team' | null;
  assignedToMe: boolean | null;
}

type CoManagedProjectTaskReferenceRow = {
  reference_id: string;
  task_id: string;
  revision: number;
  task_name: string | null;
  project_name: string | null;
  organization_name: string | null;
  assignee_name: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
};

export function projectCoManagedProjectTaskReferenceSnapshot(
  redactedFields: readonly string[],
  reference: CoManagedProjectTaskReferenceRow,
  actorUserId: string,
): CoManagedProjectTaskReference {
  const projected = maskCoManagedSnapshot(redactedFields, {
    taskName: reference.task_name,
    projectName: reference.project_name,
    organizationName: reference.organization_name,
    assigneeName: reference.assignee_name,
  }, {
    taskName: coManagedTaskFieldAliases('task_name'),
    projectName: coManagedTaskFieldAliases('project_name'),
    organizationName: coManagedTaskFieldAliases('organization_name'),
    assigneeName: coManagedTaskFieldAliases('assignee_name'),
  });

  return {
    referenceId: reference.reference_id,
    revision: reference.revision,
    ...projected,
    hasAssignment: Boolean(reference.assigned_team_id || reference.assigned_to),
    assigneeKind: reference.assigned_team_id ? 'team' : reference.assigned_to ? 'user' : null,
    assignedToMe: isCoManagedReadFieldHidden(redactedFields, coManagedTaskFieldAliases('assignee_name')) ? null : reference.assigned_to === actorUserId,
  };
}

/**
 * Read display snapshots only from inside `withCoManagedSharedWork` and return their current-policy projection.
 * Callers cannot accidentally serialize the cached names without passing through this boundary.
 */
export async function readCoManagedProjectTaskReferences(
  context: CoManagedSharedWorkContext,
  taskIds: readonly string[],
  options: { lock?: boolean } = {},
): Promise<Map<string, CoManagedProjectTaskReference>> {
  if (context.resource.kind !== 'project' && context.resource.kind !== 'project_task') throw new CoManagedSharedWorkError();
  if (taskIds.some(taskId => !taskId)) throw new CoManagedSharedWorkError();
  if (taskIds.length === 0) return new Map();

  const requestedIds = [...new Set(taskIds.map(taskId => taskId.toLowerCase()))];
  if (context.resource.kind === 'project_task' && requestedIds.some(taskId => taskId !== context.resource.id.toLowerCase())) throw new CoManagedSharedWorkError();

  const customer = tenantDb(context.trx, context.resource.tenant);
  const admittedTasks = customer.table('project_tasks as task');
  customer.tenantJoin(admittedTasks, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  admittedTasks.whereIn('task.task_id', requestedIds);
  if (context.resource.kind === 'project_task') admittedTasks.where('task.task_id', context.resource.id);
  else admittedTasks.where('phase.project_id', context.resource.id);
  const admittedTaskIds = (await admittedTasks.select('task.task_id')).map(row => String(row.task_id).toLowerCase());
  if (admittedTaskIds.length !== requestedIds.length) throw new CoManagedSharedWorkError();

  const query = tenantDb(context.trx, context.actor.tenant).table('co_managed_project_task_references')
    .where({ customer_tenant: context.resource.tenant, relationship_id: context.resource.relationshipId, active: true })
    .whereIn('task_id', admittedTaskIds);
  if (options.lock) query.forUpdate();
  const references = await query.select('reference_id', 'task_id', 'revision', 'task_name', 'project_name', 'organization_name', 'assignee_name', 'assigned_to', 'assigned_team_id') as CoManagedProjectTaskReferenceRow[];
  return new Map(references.map(reference => [reference.task_id.toLowerCase(), projectCoManagedProjectTaskReferenceSnapshot(context.redactedFields, reference, context.actor.userId)]));
}
