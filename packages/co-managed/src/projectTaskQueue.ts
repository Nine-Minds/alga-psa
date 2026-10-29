import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { withCoManagedSharedWork } from './sharedWork';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, isCoManagedUuid, isCoManagedSharedWorkError, CoManagedSharedWorkError,
  type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { assertCoManagedProjectWorkServed } from './projectTaskGate';

const MAX_PAGE = 100;
const pageSize = (limit?: number) => Number.isInteger(limit) && limit! > 0 ? Math.min(limit!, MAX_PAGE) : 50;

export interface CoManagedSharedProjectRow {
  customerTenant: string; relationshipId: string; projectId: string; projectName: string; organizationName: string; canCollaborate: boolean;
}
export interface CoManagedSharedProjectPage { rows: CoManagedSharedProjectRow[]; next: { relationshipId: string; projectId: string } | null }

/**
 * The projects a technician may work or oversee right now. Scope rows only nominate candidates:
 * every candidate is re-admitted through L2's `withCoManagedSharedWork` (grant, staff role, home RBAC,
 * lifecycle), and a denied or field-redacted project is dropped, never inferred from a sibling column.
 * A project that was not shared, or whose grant was revoked, therefore never appears.
 */
export async function listCoManagedSharedProjects(db: Knex, inputActor: CoManagedSessionActor,
  options: { relationshipId?: string; limit?: number; after?: { relationshipId: string; projectId: string } } = {}): Promise<CoManagedSharedProjectPage> {
  const actor = snapshotCoManagedSessionActor(inputActor), limit = pageSize(options.limit);
  if ((options.relationshipId !== undefined && !isCoManagedUuid(options.relationshipId)) ||
      (options.after && (!isCoManagedUuid(options.after.relationshipId) || !isCoManagedUuid(options.after.projectId)))) throw new CoManagedSharedWorkError();
  await assertCoManagedProjectWorkServed(actor.tenant);
  // Candidate relationships come from the MSP's own staff assignments (user or team).
  const relationships = await withTransaction(db, async trx => {
    const subject = await lockCoManagedSessionIdentity(trx, actor);
    const query = tenantDb(trx, actor.tenant).table('co_management_staff_assignments')
      .where(scope => scope.where({ principal_type: 'user', principal_id: actor.userId }).orWhere(team => team.where('principal_type', 'team').whereIn('principal_id', [...(subject.teamIds ?? [])])))
      .distinct('customer_tenant', 'relationship_id').orderBy('relationship_id');
    if (options.relationshipId) query.where('relationship_id', options.relationshipId.toLowerCase());
    if (options.after) query.where('relationship_id', '>=', options.after.relationshipId.toLowerCase());
    return query as Promise<Array<{ customer_tenant: string; relationship_id: string }>>;
  });
  const rows: CoManagedSharedProjectRow[] = [];
  let next: CoManagedSharedProjectPage['next'] = null;
  walk: for (const relation of relationships) {
    let cursor = options.after && options.after.relationshipId.toLowerCase() === relation.relationship_id ? options.after.projectId.toLowerCase() : null;
    // Keyset walk over the customer's scope rows; candidates are admitted one at a time.
    for (;;) {
      const candidates = await withTransaction(db, trx => {
        const query = tenantDb(trx, relation.customer_tenant).table('co_management_project_scopes')
          .where('relationship_id', relation.relationship_id).orderBy('project_id').limit(limit);
        if (cursor) query.where('project_id', '>', cursor);
        return query.select('project_id') as Promise<Array<{ project_id: string }>>;
      });
      for (const candidate of candidates) {
        if (rows.length >= limit) { const last = rows[rows.length - 1]; next = { relationshipId: last.relationshipId, projectId: last.projectId }; break walk; }
        cursor = candidate.project_id;
        const row = await readProject(db, actor, relation.customer_tenant, relation.relationship_id, candidate.project_id);
        if (row) rows.push(row);
      }
      if (candidates.length < limit) break;
    }
  }
  return { rows, next };
}

async function readProject(db: Knex, actor: CoManagedSessionActor, customerTenant: string, relationshipId: string, projectId: string): Promise<CoManagedSharedProjectRow | null> {
  try {
    return await withCoManagedSharedWork(db, actor, { tenant: customerTenant, relationshipId, kind: 'project', id: projectId }, 'read', async context => {
      if (isCoManagedReadFieldHidden(context.redactedFields, ['project_name', 'projectName', 'values.project_name', 'projects.project_name', 'project', 'project_id', 'projects'])) return null;
      const customer = tenantDb(context.trx, customerTenant);
      const project = await customer.table('projects').where('project_id', projectId).first('project_name');
      const scope = await customer.table('co_management_project_scopes').where({ relationship_id: relationshipId, project_id: projectId }).first('can_collaborate');
      const organization = isCoManagedReadFieldHidden(context.redactedFields, ['client_name', 'organizationName', 'tenants']) ? null : await customer.table('tenants').first('client_name');
      if (!project || !scope) return null;
      return { customerTenant, relationshipId, projectId, projectName: project.project_name, organizationName: organization?.client_name ?? '', canCollaborate: Boolean(scope.can_collaborate) };
    });
  } catch (error) {
    if (isCoManagedSharedWorkError(error)) return null;
    throw error;
  }
}

export interface CoManagedSharedTaskRow {
  taskId: string; taskName: string; dueDate: string | null; taskUpdatedAt: string;
  reference: { revision: number; assigneeName: string; assignedToMe: boolean } | null;
}
export interface CoManagedSharedTaskPage { rows: CoManagedSharedTaskRow[]; nextAfterTaskId: string | null }

/** Tasks of ONE admitted shared project, keyset-paged. Admission is for the project, so a task of an
 * unshared project is unreachable: the project check fails before any task row is read. */
export async function listCoManagedSharedProjectTasks(db: Knex, inputActor: CoManagedSessionActor,
  target: { customerTenant: string; relationshipId: string; projectId: string }, options: { limit?: number; afterTaskId?: string } = {}): Promise<CoManagedSharedTaskPage> {
  const actor = snapshotCoManagedSessionActor(inputActor), limit = pageSize(options.limit);
  if (!target || ![target.customerTenant, target.relationshipId, target.projectId].every(isCoManagedUuid) || (options.afterTaskId !== undefined && !isCoManagedUuid(options.afterTaskId))) throw new CoManagedSharedWorkError();
  await assertCoManagedProjectWorkServed(actor.tenant);
  return withCoManagedSharedWork(db, actor, { tenant: target.customerTenant.toLowerCase(), relationshipId: target.relationshipId.toLowerCase(), kind: 'project', id: target.projectId.toLowerCase() }, 'read', async context => {
    // A redacted task name drops the task row: nothing is inferred from a sibling column.
    if (isCoManagedReadFieldHidden(context.redactedFields, ['task_name', 'values.task_name', 'project_tasks.task_name', 'project_tasks', 'tasks'])) return { rows: [], nextAfterTaskId: null };
    const customer = tenantDb(context.trx, target.customerTenant.toLowerCase());
    const query = customer.table('project_tasks as task').orderBy('task.task_id').limit(limit + 1).where('phase.project_id', target.projectId.toLowerCase());
    customer.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    if (options.afterTaskId) query.where('task.task_id', '>', options.afterTaskId.toLowerCase());
    const tasks = await query.select('task.task_id', 'task.task_name', 'task.due_date', 'task.updated_at');
    const page = tasks.slice(0, limit);
    const references = page.length ? await tenantDb(context.trx, actor.tenant).table('co_managed_project_task_references')
      .where({ customer_tenant: target.customerTenant.toLowerCase(), relationship_id: target.relationshipId.toLowerCase(), active: true }).whereIn('task_id', page.map(task => task.task_id))
      .select('task_id', 'revision', 'assignee_name', 'assigned_to') : [];
    const byTask = new Map(references.map(reference => [reference.task_id, reference]));
    const dueHidden = isCoManagedReadFieldHidden(context.redactedFields, ['due_date', 'values.due_date', 'project_tasks.due_date']);
    return {
      rows: page.map(task => {
        const reference = byTask.get(task.task_id);
        return { taskId: task.task_id, taskName: task.task_name, dueDate: dueHidden || !task.due_date ? null : new Date(task.due_date).toISOString(), taskUpdatedAt: new Date(task.updated_at).toISOString(),
          reference: reference ? { revision: reference.revision, assigneeName: reference.assignee_name, assignedToMe: reference.assigned_to === actor.userId } : null };
      }),
      nextAfterTaskId: tasks.length > limit ? page[page.length - 1].task_id : null,
    };
  });
}
