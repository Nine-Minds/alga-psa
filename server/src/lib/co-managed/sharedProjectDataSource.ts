import type { CoManagedSharedProjectScreen, CoManagedSharedProjectScreenTask, CoManagedTaskSnapshot } from '@alga-psa/co-managed';
import { nativeProjectDataSource } from '@alga-psa/projects/lib/nativeProjectDataSource';
import {
  PROJECT_DATA_SOURCE_METHODS, PROJECT_TASK_SCREEN_FIELDS, projectDataSourceMethod,
  type ProjectDataSource, type ProjectDataSourceMethod, type ProjectScreenBehavior, type ProjectScreenSlots,
  type ProjectTaskEditRequest, type ProjectTaskEditResult,
} from '@alga-psa/projects/lib/projectDataSource';
import type { CoManagedTaskCommandResult } from '@/lib/actions/coManagedProjectTaskActions';

/**
 * The native project screen's data source for ONE customer project shared with an MSP technician.
 *
 * Bound to one (customerTenant, relationshipId, projectId). Every read is answered from the single authorized
 * screen read; every write is either the admitted task edit (task_name, project_status_mapping_id, due_date) or a
 * loud failure. Nothing here may reach a native project action: those are fixed to the viewer's own tenant and would
 * read or write the MSP's data under a customer's project id. This module imports no action module at runtime; it takes
 * only the SHAPE of `nativeProjectDataSource` (its method names) and never calls a method on it.
 */
export class CoManagedReadOnlyProjectError extends Error {
  constructor(public readonly group: string, public readonly method: string) {
    super(`Shared co-managed projects do not support this change (${group}.${method})`);
    this.name = 'CoManagedReadOnlyProjectError';
  }
}

/** The task fields a technician may change on a customer's task (packages/co-managed projectTaskEditing). */
export const CO_MANAGED_ADMITTED_TASK_FIELDS = ['task_name', 'project_status_mapping_id', 'due_date'] as const;

export type CoManagedSharedProjectRead = CoManagedSharedProjectScreen;
export type CoManagedProjectEditRequest = { operationId?: string; expectedRevision: number; expectedTaskUpdatedAt: string; patch: Record<string, string | null> };
export type CoManagedProjectEditResult = CoManagedTaskCommandResult<{ revision: number; taskUpdatedAt: string }>;

export interface CoManagedSharedProjectDataSourceDeps {
  customerTenant: string;
  relationshipId: string;
  projectId: string;
  backHref: string;
  /** The authorized screen read (getCoManagedSharedProjectScreenAction); null when not served or not admitted. Injected so it is unit-testable. */
  load: () => Promise<CoManagedSharedProjectRead | null>;
  edit: (taskId: string, request: CoManagedProjectEditRequest) => Promise<CoManagedProjectEditResult>;
  snapshot?: (taskId: string) => Promise<CoManagedTaskSnapshot | null>;
  slots?: Partial<ProjectScreenSlots>;
  /** Mints an operation id when the screen did not send one. */
  newOperationId?: () => string;
}

const notFound = () => ({ actionError: 'Project not found' }) as never;
const actionError = (message: string) => ({ actionError: message }) as never;
const date = (value: string | null) => value ? new Date(value) : null;

type Group = Record<string, (...args: any[]) => unknown>;
const GROUPS = ['project', 'tasks', 'options', 'phases'] as const;

// LEVERAGE: friction native-tenant-actions — every native project action is fixed to the viewer's tenant; the seam exists because that assumption is not parameterisable yet.
/** Every method of the native shape, each one throwing. Nothing falls through to a native action. */
function throwingBase(): { groups: Record<(typeof GROUPS)[number], Group>; editTask: ProjectDataSource['editTask'] } {
  const groups = Object.fromEntries(GROUPS.map(name => [name, Object.fromEntries(
    Object.keys(nativeProjectDataSource[name] as object).map(method => [method, () => { throw new CoManagedReadOnlyProjectError(name, method); }]))])) as unknown as Record<(typeof GROUPS)[number], Group>;
  return { groups, editTask: () => { throw new CoManagedReadOnlyProjectError('editTask', 'editTask'); } };
}

export interface LoadedCoManagedSharedProjectDataSource {
  source: ProjectDataSource;
  /** Re-reads the project and refreshes the per-task baselines (call after an assignment bumps a reference revision). */
  refresh(): Promise<boolean>;
  /** The MSP reference as last loaded or saved (display name only), for the drawer's assignment panel. */
  baselineOf(taskId: string): { revision: number | null; assigneeName: string | null; isAssigned: boolean } | null;
  /** Status display names by mapping id, for the history panel. */
  statusNames(): Record<string, string>;
  /** Called after a refresh and after every edit receipt or conflict; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Awaits the authorized read, then composes the source with its final screen values. Null when the project is not served/admitted. */
export async function loadCoManagedSharedProjectDataSource(deps: CoManagedSharedProjectDataSourceDeps): Promise<LoadedCoManagedSharedProjectDataSource | null> {
  const initial = await deps.load();
  if (!initial || initial.project.projectId !== deps.projectId) return null;
  return createCoManagedSharedProjectDataSource(deps, initial);
}

export function createCoManagedSharedProjectDataSource(deps: CoManagedSharedProjectDataSourceDeps, initial: CoManagedSharedProjectRead): LoadedCoManagedSharedProjectDataSource {
  let read = initial;
  const baselines = new Map<string, { revision: number | null; taskUpdatedAt: string }>();
  const rows = new Map<string, CoManagedSharedProjectScreenTask>();
  const absorb = (next: CoManagedSharedProjectRead) => {
    read = next; baselines.clear(); rows.clear();
    for (const task of next.tasks) { rows.set(task.taskId, { ...task }); baselines.set(task.taskId, { revision: task.reference?.revision ?? null, taskUpdatedAt: task.taskUpdatedAt }); }
  };
  absorb(initial);
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());

  // Derived server-side from the reader's redactions (the matcher is server-only code).
  const hidden = [...(initial.hiddenTaskFields ?? [])];
  const admitted = CO_MANAGED_ADMITTED_TASK_FIELDS.filter(field => !hidden.includes(field));
  const screen: ProjectScreenBehavior = Object.freeze({
    readOnly: false, admittedTaskEdit: true, hideCreate: true, hidePhaseMoves: true, hideKanbanDrag: false, freezeProjectEdit: true,
    frozenFields: Object.freeze(PROJECT_TASK_SCREEN_FIELDS.filter(field => !(admitted as readonly string[]).includes(field) && !hidden.includes(field))),
    hiddenFields: Object.freeze([...hidden]), backHref: deps.backHref,
    // L4c: no project-task conversation seam exists on main (nativeTaskCommentAccess is customer-side only). L6a2 is not on main.
    slots: Object.freeze({ conversations: null, timeSummary: null, taskAside: deps.slots?.taskAside ?? null }),
  });

  const status = (s: CoManagedSharedProjectRead['statuses'][number]) => ({
    project_status_mapping_id: s.statusMappingId, status_id: s.statusMappingId, name: s.name, custom_name: s.customName, display_order: s.displayOrder,
    is_visible: s.isVisible, is_standard: false, is_closed: s.isClosed, color: s.color, icon: s.icon, ...(s.phaseId ? { phase_id: s.phaseId } : {}),
  });
  const toTask = (task: CoManagedSharedProjectScreenTask) => ({
    tenant: deps.customerTenant, task_id: task.taskId, phase_id: task.phaseId, task_name: task.taskName, description: null, assigned_to: null, assigned_team_id: null,
    estimated_hours: null, actual_hours: null, project_status_mapping_id: task.statusMappingId as string, created_at: new Date(task.taskUpdatedAt), updated_at: new Date(task.taskUpdatedAt),
    wbs_code: task.wbsCode ?? '', order_key: task.orderKey ?? undefined, start_date: null, due_date: date(task.dueDate), priority_id: null, task_type_key: 'task',
    checklist_items: [], ticket_links: [], resources: [], dependencies: [], dependents: [],
    // The MSP assignee is a display name only; ids never leave the server.
    assigned_to_name: task.reference?.assigneeName ?? undefined,
  });
  const byOrder = (a: CoManagedSharedProjectScreenTask, b: CoManagedSharedProjectScreenTask) => (a.orderKey ?? '') < (b.orderKey ?? '') ? -1 : (a.orderKey ?? '') > (b.orderKey ?? '') ? 1 : 0;
  const phaseIds = () => new Set(read.phases.map(phase => phase.phaseId));
  const inProject = (projectId: string) => projectId === deps.projectId;

  const metadata = async (projectId: string) => {
    if (!inProject(projectId)) return notFound();
    const p = read.project;
    return {
      project: {
        tenant: deps.customerTenant, project_id: p.projectId, project_name: p.projectName, client_name: p.organizationName, description: null, wbs_code: '', project_number: '',
        is_inactive: false, status: '', status_name: p.statusName ?? undefined, is_closed: p.isClosed ?? undefined, start_date: date(p.startDate), end_date: date(p.endDate),
        created_at: new Date(0), updated_at: new Date(0), client_id: '',
      },
      phases: read.phases.map((phase, index) => ({
        tenant: deps.customerTenant, phase_id: phase.phaseId, project_id: phase.projectId, phase_name: phase.phaseName ?? '', description: null, start_date: null, end_date: null,
        status: '', order_number: index + 1, order_key: phase.orderKey ?? undefined, wbs_code: phase.wbsCode ?? '', created_at: new Date(0), updated_at: new Date(0),
      })),
      statuses: read.statuses.map(status), users: [], clients: [], assignedUser: null,
    } as never;
  };

  const tasksData = async (projectId: string) => {
    if (!inProject(projectId)) return notFound();
    const tasks = [...rows.values()].sort(byOrder).map(toTask);
    return { tasks, taskResources: {}, taskTags: {}, checklistItems: {}, taskDependencies: {} } as never;
  };
  const tasksForPhase = async (phaseId: string) => {
    if (!phaseIds().has(phaseId)) return notFound();
    const tasks = [...rows.values()].filter(task => task.phaseId === phaseId).sort(byOrder).map(toTask);
    return { tasks, ticketLinks: {}, taskResources: {}, taskDependencies: {}, checklistItems: {}, taskTags: {} } as never;
  };

  const pending = new Map<string, string>();
  const editTask = async (request: ProjectTaskEditRequest): Promise<ProjectTaskEditResult> => {
    const row = rows.get(request.taskId);
    if (!row) return { ok: false, code: 'not_found' };
    const changes = request.changes ?? {};
    // A field the screen cannot save is refused, never dropped: nothing is written when any one is refused.
    const refusedFields = Object.keys(changes).filter(key => !(admitted as readonly string[]).includes(key));
    if (refusedFields.length) return { ok: false, code: 'refused', refusedFields };
    if (!Object.keys(changes).length) return { ok: true, task: toTask(row) as never };
    const baseline = baselines.get(request.taskId);
    if (!baseline || baseline.revision === null) return { ok: false, code: 'not_found', message: 'Assign this task to edit it' };

    const patch: Record<string, string | null> = {};
    for (const field of admitted) {
      if (!Object.hasOwn(changes, field)) continue;
      const value = changes[field];
      patch[field] = value instanceof Date ? value.toISOString() : (value as string | null | undefined) ?? null;
    }
    const key = JSON.stringify([request.taskId, baseline.revision, baseline.taskUpdatedAt, patch]);
    // A repeat of the same intended edit keeps its operation id, so a retry after a lost response replays.
    const operationId = request.operationId ?? pending.get(key) ?? deps.newOperationId?.();
    if (operationId) pending.set(key, operationId);
    let result: CoManagedProjectEditResult;
    try {
      result = await deps.edit(request.taskId, { ...(operationId ? { operationId } : {}), expectedRevision: baseline.revision, expectedTaskUpdatedAt: baseline.taskUpdatedAt, patch });
    } catch (error) {
      // Ambiguous outcome: keep the operation id for an exact retry.
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : undefined };
    }
    pending.delete(key);
    if (result.success) {
      baselines.set(request.taskId, { revision: result.receipt.revision, taskUpdatedAt: result.receipt.taskUpdatedAt });
      if (typeof patch.task_name === 'string') row.taskName = patch.task_name;
      if ('project_status_mapping_id' in patch) row.statusMappingId = patch.project_status_mapping_id;
      if ('due_date' in patch) row.dueDate = patch.due_date;
      row.taskUpdatedAt = result.receipt.taskUpdatedAt;
      if (row.reference) row.reference = { ...row.reference, revision: result.receipt.revision };
      emit();
      return { ok: true, task: toTask(row) as never };
    }
    if (result.error === 'CONFLICT') {
      const fresh = result.snapshot;
      if (fresh) {
        baselines.set(request.taskId, { revision: fresh.revision, taskUpdatedAt: fresh.taskUpdatedAt });
        if (typeof fresh.values.task_name === 'string') row.taskName = fresh.values.task_name;
        if ('project_status_mapping_id' in fresh.values) row.statusMappingId = fresh.values.project_status_mapping_id ?? null;
        if ('due_date' in fresh.values) row.dueDate = fresh.values.due_date ?? null;
        row.taskUpdatedAt = fresh.taskUpdatedAt;
        if (row.reference) row.reference = { ...row.reference, revision: fresh.revision };
      }
      emit();
      return { ok: false, code: 'conflict', task: toTask(row) as never };
    }
    return result.error === 'INVALID' ? { ok: false, code: 'invalid' } : { ok: false, code: 'not_found' };
  };

  const updateStatus = async (taskId: string, targetStatusMappingId: string) => {
    const result = await editTask({ taskId, changes: { project_status_mapping_id: targetStatusMappingId } });
    if (result.ok) return result.task as never;
    if (result.code === 'conflict') return actionError('This task was changed by someone else. It has been reloaded; try again.');
    if (result.code === 'refused') return actionError('This change is not shared with you.');
    return actionError(result.message ?? 'The task could not be moved.');
  };

  const taskStatuses = async (projectId: string, phaseId?: string | null) => {
    if (!inProject(projectId)) return [] as never;
    const list = phaseId ? read.statusesByPhase[phaseId] ?? [] : read.statuses;
    return list.map(status) as never;
  };
  const statusesByPhase = async (projectId: string) => {
    if (!inProject(projectId)) return notFound();
    return Object.fromEntries(Object.entries(read.statusesByPhase).map(([phaseId, list]) => [phaseId, list.map(status)])) as never;
  };

  const base = throwingBase();
  const implemented: Record<ProjectDataSourceMethod, (...args: any[]) => unknown> = {
    'project.metadata': metadata,
    'project.update': base.groups.project.update,
    'tasks.data': tasksData,
    'tasks.forPhase': tasksForPhase,
    'tasks.get': async (taskId: string) => {
      const row = rows.get(taskId);
      return row ? toTask(row) : null;
    },
    'tasks.commentCounts': async (taskIds: string[]) => Object.fromEntries((taskIds ?? []).map(id => [id, 0])),
    'tasks.updateStatus': updateStatus,
    'tasks.reorder': base.groups.tasks.reorder,
    'tasks.reorderInStatus': base.groups.tasks.reorderInStatus,
    'tasks.moveToPhase': base.groups.tasks.moveToPhase,
    'tasks.update': base.groups.tasks.update,
    'options.taskStatuses': taskStatuses,
    'options.statusesByPhase': statusesByPhase,
    'options.types': async () => [],
    'options.tree': async () => [],
    'phases.customStatusCounts': async () => ({}),
    'phases.reorder': base.groups.phases.reorder,
    'phases.update': base.groups.phases.update,
    editTask,
  };

  const groups: Record<string, Group> = { project: {}, tasks: {}, options: {}, phases: {} };
  let top: Record<string, unknown> = {};
  for (const path of PROJECT_DATA_SOURCE_METHODS) {
    const fn = implemented[path];
    if (typeof fn !== 'function') throw new Error(`Shared project data source is missing ${path}`);
    const [head, tail] = path.split('.');
    if (tail) groups[head][tail] = fn; else top = { ...top, [head]: fn };
  }
  const source = Object.freeze({
    kind: 'co-managed-shared', boundProjectId: deps.projectId, screen,
    project: Object.freeze(groups.project), tasks: Object.freeze(groups.tasks), options: Object.freeze(groups.options), phases: Object.freeze(groups.phases),
    ...top,
  }) as unknown as ProjectDataSource;

  // The shape must equal the native shape: a method the native source has and this one lacks would be a silent hole.
  for (const path of PROJECT_DATA_SOURCE_METHODS) {
    if (!projectDataSourceMethod(source, path)) throw new Error(`Shared project data source is missing ${path}`);
  }
  return {
    source,
    refresh: async () => {
      const next = await deps.load();
      if (!next || next.project.projectId !== deps.projectId) return false;
      absorb(next);
      emit();
      return true;
    },
    baselineOf: taskId => {
      const row = rows.get(taskId);
      return row ? { revision: baselines.get(taskId)?.revision ?? null, assigneeName: row.reference?.assigneeName ?? null, isAssigned: row.reference != null } : null;
    },
    statusNames: () => Object.fromEntries(Object.values(read.statusesByPhase).flat().concat(read.statuses).map(status => [status.statusMappingId, status.name])),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
