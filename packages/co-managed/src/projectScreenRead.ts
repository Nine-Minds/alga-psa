import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedSharedWork, type CoManagedSharedResource } from './sharedWork';
import { snapshotCoManagedSessionActor, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { isCoManagedTaskResourceHidden, maskCoManagedSnapshot, CO_MANAGED_TASK_NAME_ALIASES, CO_MANAGED_PROJECT_NAME_ALIASES,
  CO_MANAGED_PHASE_NAME_ALIASES, CO_MANAGED_ASSIGNEE_NAME_ALIASES } from './sharedWorkProjection';
import { readCoManagedCustomerOrganizationName } from './projectTaskQueue';
import { assertCoManagedProjectWorkServed } from './projectTaskGate';

/**
 * Everything the native project screen needs for ONE admitted shared project, read inside a single
 * `withCoManagedSharedWork(... 'read')` admission. Display names only: no user ids, client ids or avatar urls.
 * Redacted values are null (never dropped, never inferred from a sibling column).
 */
export interface CoManagedSharedProjectScreenStatus {
  statusMappingId: string; phaseId: string | null; name: string; customName: string | null; displayOrder: number;
  isVisible: boolean; isClosed: boolean; color: string | null; icon: string | null;
}
export interface CoManagedSharedProjectScreenPhase { phaseId: string; projectId: string; phaseName: string | null; wbsCode: string | null; orderKey: string | null }
export interface CoManagedSharedProjectScreenTask {
  taskId: string; taskName: string; phaseId: string; statusMappingId: string | null; dueDate: string | null; wbsCode: string | null;
  orderKey: string | null; taskUpdatedAt: string;
  /** The task row's real created_at (same query as the rest of the row). */
  taskCreatedAt: string;
  reference: { revision: number; assigneeName: string | null; assignedToMe: boolean } | null;
}
export interface CoManagedSharedProjectScreen {
  project: { projectId: string; projectName: string; statusName: string | null; isClosed: boolean | null; startDate: string | null; endDate: string | null; organizationName: string };
  canCollaborate: boolean;
  phases: CoManagedSharedProjectScreenPhase[];
  /** Project-level (phase_id null) status mappings. */
  statuses: CoManagedSharedProjectScreenStatus[];
  /** Effective statuses per phase: the phase's own mappings, else the project defaults (the native rule). */
  statusesByPhase: Record<string, CoManagedSharedProjectScreenStatus[]>;
  tasks: CoManagedSharedProjectScreenTask[];
  redactedFields: string[];
  /** Task fields (project_tasks column names) hidden from this reader, derived server-side so clients never need the redaction matcher. */
  hiddenTaskFields: string[];
}

/** The `project_tasks` fields the native task drawer renders; mirrors PROJECT_TASK_SCREEN_FIELDS in @alga-psa/projects. */
export const CO_MANAGED_SCREEN_TASK_FIELDS = [
  'task_name', 'description', 'project_status_mapping_id', 'phase_id', 'assigned_to', 'assigned_team_id',
  'estimated_hours', 'start_date', 'due_date', 'priority_id', 'task_type_key', 'service_id',
  'checklist_items', 'tags', 'resources', 'dependencies', 'ticket_links',
] as const;

const STATUS_EXTRA_ALIASES = ['status', 'selectedStatus', 'status_id', 'status_name', 'project_status_mappings'];
const fieldAliases = (field: string): string[] =>
  [field, `values.${field}`, `project_tasks.${field}`, ...(field === 'project_status_mapping_id' ? STATUS_EXTRA_ALIASES : [])];

/** Task fields the reader's redactions hide. A hidden status hides `project_status_mapping_id`. */
export function coManagedHiddenTaskFields(redactedFields: readonly string[]): string[] {
  if (isCoManagedTaskResourceHidden(redactedFields)) return [...CO_MANAGED_SCREEN_TASK_FIELDS];
  return CO_MANAGED_SCREEN_TASK_FIELDS.filter(field => isCoManagedReadFieldHidden(redactedFields, fieldAliases(field)));
}

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
const isoOrNull = (value: unknown): string | null => value == null ? null : iso(value);
const TASK_PAGE = 500;

export async function getCoManagedSharedProjectScreen(db: Knex, inputActor: CoManagedSessionActor,
  target: { customerTenant: string; relationshipId: string; projectId: string }): Promise<CoManagedSharedProjectScreen> {
  // Gate first: a tenant the capability does not serve never reaches a co_management_* statement.
  const actor = snapshotCoManagedSessionActor(inputActor);
  await assertCoManagedProjectWorkServed(actor.tenant);
  if (!target || ![target.customerTenant, target.relationshipId, target.projectId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const customerTenant = target.customerTenant.toLowerCase(), relationshipId = target.relationshipId.toLowerCase(), projectId = target.projectId.toLowerCase();

  return withCoManagedSharedWork(db, actor, { tenant: customerTenant, relationshipId, kind: 'project', id: projectId }, 'read', async context => {
    const redacted = context.redactedFields;
    // A project whose name is redacted is dropped as a whole, exactly like the project list does.
    if (isCoManagedReadFieldHidden(redacted, CO_MANAGED_PROJECT_NAME_ALIASES)) throw new CoManagedSharedWorkError();
    const customer = tenantDb(context.trx, customerTenant);

    const projectQuery = customer.table('projects').where('projects.project_id', projectId);
    customer.tenantJoin(projectQuery, 'statuses as s', 'projects.status', 's.status_id', { type: 'left' });
    const project = await projectQuery.first('projects.project_name', 'projects.start_date', 'projects.end_date', 's.name as status_name', 's.is_closed as status_is_closed');
    const scope = await customer.table('co_management_project_scopes').where({ relationship_id: relationshipId, project_id: projectId }).first('can_collaborate');
    if (!project || !scope) throw new CoManagedSharedWorkError();
    const datesHidden = (name: string) => isCoManagedReadFieldHidden(redacted, [name, `values.${name}`, `projects.${name}`]);
    const projectStatusHidden = isCoManagedReadFieldHidden(redacted, ['status', 'projects.status', 'status_name', 'is_closed', 'values.status']);
    const organizationName = await readCoManagedCustomerOrganizationName(context.trx, customerTenant, redacted);

    const phaseNameHidden = isCoManagedReadFieldHidden(redacted, CO_MANAGED_PHASE_NAME_ALIASES);
    const phaseRows = await customer.table('project_phases').where('project_id', projectId).orderBy('order_key')
      .select('phase_id', 'project_id', 'phase_name', 'wbs_code', 'order_key') as Array<Record<string, any>>;
    const phases: CoManagedSharedProjectScreenPhase[] = phaseRows.map(row => ({
      phaseId: row.phase_id, projectId: row.project_id, phaseName: phaseNameHidden ? null : row.phase_name, wbsCode: row.wbs_code ?? null, orderKey: row.order_key ?? null,
    }));

    // Statuses: the same mappings listCoManagedProjectTaskStatusOptions offers (project-level or phase-level), with the
    // native fallback rule applied for display. Hidden status => no mappings and no task status.
    const statusHidden = isCoManagedReadFieldHidden(redacted, fieldAliases('project_status_mapping_id'));
    let statuses: CoManagedSharedProjectScreenStatus[] = [];
    const statusesByPhase: Record<string, CoManagedSharedProjectScreenStatus[]> = {};
    if (!statusHidden) {
      const mappingQuery = customer.table('project_status_mappings as psm').where('psm.project_id', projectId);
      customer.tenantJoin(mappingQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
      customer.tenantJoin(mappingQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
      const mappings = await mappingQuery.orderBy('psm.display_order').select('psm.project_status_mapping_id', 'psm.phase_id', 'psm.custom_name', 'psm.display_order', 'psm.is_visible',
        context.trx.raw('COALESCE(s.name, ss.name) as name'), context.trx.raw('COALESCE(s.is_closed, ss.is_closed) as is_closed'), 's.color as color', 's.icon as icon') as Array<Record<string, any>>;
      const all = mappings.filter(row => row.custom_name || row.name).map((row): CoManagedSharedProjectScreenStatus => ({
        statusMappingId: row.project_status_mapping_id, phaseId: row.phase_id ?? null, name: row.custom_name || row.name, customName: row.custom_name ?? null,
        displayOrder: Number(row.display_order), isVisible: row.is_visible !== false, isClosed: Boolean(row.is_closed), color: row.color ?? null, icon: row.icon ?? null,
      }));
      statuses = all.filter(status => status.phaseId === null);
      for (const phase of phases) {
        const own = all.filter(status => status.phaseId === phase.phaseId);
        statusesByPhase[phase.phaseId] = own.length ? own : statuses;
      }
    }

    // Tasks: keyset-paged inside this one admission so a large project is complete. A redacted task name drops the rows.
    const tasks: CoManagedSharedProjectScreenTask[] = [];
    const taskResourceHidden = isCoManagedTaskResourceHidden(redacted) || isCoManagedReadFieldHidden(redacted, CO_MANAGED_TASK_NAME_ALIASES);
    if (!taskResourceHidden && phases.length) {
      const dueHidden = isCoManagedReadFieldHidden(redacted, fieldAliases('due_date'));
      let after: string | null = null;
      for (;;) {
        const query = customer.table('project_tasks as task').where('phase.project_id', projectId).orderBy('task.task_id').limit(TASK_PAGE);
        customer.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
        if (after) query.where('task.task_id', '>', after);
        const page = await query.select('task.task_id', 'task.task_name', 'task.phase_id', 'task.project_status_mapping_id', 'task.due_date', 'task.wbs_code', 'task.order_key', 'task.created_at', 'task.updated_at') as Array<Record<string, any>>;
        if (!page.length) break;
        const references = await tenantDb(context.trx, actor.tenant).table('co_managed_project_task_references')
          .where({ customer_tenant: customerTenant, relationship_id: relationshipId, active: true }).whereIn('task_id', page.map(task => task.task_id))
          .select('task_id', 'revision', 'assignee_name', 'assigned_to') as Array<Record<string, any>>;
        const byTask = new Map(references.map(reference => [reference.task_id, reference]));
        for (const task of page) {
          const reference = byTask.get(task.task_id);
          tasks.push({
            taskId: task.task_id, taskName: task.task_name, phaseId: task.phase_id, statusMappingId: statusHidden ? null : task.project_status_mapping_id ?? null,
            dueDate: dueHidden ? null : isoOrNull(task.due_date), wbsCode: task.wbs_code ?? null, orderKey: task.order_key ?? null, taskCreatedAt: iso(task.created_at), taskUpdatedAt: iso(task.updated_at),
            reference: reference ? maskCoManagedSnapshot(redacted, { revision: reference.revision as number, assigneeName: reference.assignee_name as string | null, assignedToMe: reference.assigned_to === actor.userId },
              { assigneeName: CO_MANAGED_ASSIGNEE_NAME_ALIASES }) : null,
          });
        }
        after = page[page.length - 1].task_id;
        if (page.length < TASK_PAGE) break;
      }
    }

    return {
      project: {
        projectId, projectName: project.project_name, statusName: projectStatusHidden ? null : project.status_name ?? null,
        isClosed: projectStatusHidden ? null : project.status_is_closed ?? null,
        startDate: datesHidden('start_date') ? null : isoOrNull(project.start_date), endDate: datesHidden('end_date') ? null : isoOrNull(project.end_date), organizationName,
      },
      canCollaborate: Boolean(scope.can_collaborate), phases, statuses, statusesByPhase, tasks, redactedFields: [...redacted],
      hiddenTaskFields: coManagedHiddenTaskFields(redacted),
    };
  });
}

/**
 * Which project a shared task belongs to, resolved through the same L2 admission as a task read. A task link carries only a
 * task id; this is how it reaches the native project screen. Out of scope or hidden => CoManagedSharedWorkError.
 */
export async function locateCoManagedSharedTask(db: Knex, inputActor: CoManagedSessionActor, input: CoManagedSharedResource): Promise<{ projectId: string }> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  await assertCoManagedProjectWorkServed(actor.tenant);
  if (!input || input.kind !== 'project_task' || ![input.tenant, input.id, input.relationshipId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const resource: CoManagedSharedResource = { kind: 'project_task', tenant: input.tenant.toLowerCase(), id: input.id.toLowerCase(), relationshipId: input.relationshipId.toLowerCase() };
  return withCoManagedSharedWork(db, actor, resource, 'read', async context => {
    if (isCoManagedTaskResourceHidden(context.redactedFields)) throw new CoManagedSharedWorkError();
    const owner = tenantDb(context.trx, resource.tenant);
    const query = owner.table('project_tasks as task').where('task.task_id', resource.id);
    owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    const row = await query.first('phase.project_id');
    if (!row) throw new CoManagedSharedWorkError();
    return { projectId: row.project_id as string };
  });
}
