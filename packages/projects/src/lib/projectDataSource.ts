// LEVERAGE: pattern seam-datasource — project screen now has three adapters (native, co-managed-shared, and the next vertical); the ticket seam (packages/tickets/src/lib/ticketDataSource.ts) is the template.
import type * as ProjectActions from '../actions/projectActions';
import type * as ProjectTaskActions from '../actions/projectTaskActions';
import type * as ProjectTaskStatusActions from '../actions/projectTaskStatusActions';
import type * as ProjectTaskCommentActions from '../actions/projectTaskCommentActions';
import type { ReactNode } from 'react';
import type { IProjectTask } from '@alga-psa/types';

/**
 * The project screen's data source. The screen (ProjectPage, ProjectDetail, the
 * kanban and list views, the task drawer and TaskForm) never imports a project
 * action for the calls below; it reads them from this seam. Two authority models
 * implement it: `native` (today's actions, the viewer's own tenant) and
 * `co-managed-shared` (a customer's shared project, admitted by L2/L3c).
 *
 * Method types are the action types themselves, so the native implementation is a
 * forwarder by construction and the screen's result handling does not change.
 */
export type ProjectDataSourceKind = 'native' | 'co-managed-shared';

type Fn<M, K extends keyof M> = M[K] extends (...args: infer A) => infer R ? (...args: A) => R : never;

export interface ProjectDataSource {
  readonly kind: ProjectDataSourceKind;
  /** The one project a bound (shared) data source serves; its methods check incoming ids against it. */
  readonly boundProjectId?: string;
  readonly project: {
    metadata: Fn<typeof ProjectActions, 'getProjectMetadata'>;
    update: Fn<typeof ProjectActions, 'updateProject'>;
  };
  readonly tasks: {
    data: Fn<typeof ProjectTaskActions, 'getProjectTaskData'>;
    forPhase: Fn<typeof ProjectTaskActions, 'getTasksForPhase'>;
    get: Fn<typeof ProjectTaskActions, 'getTaskById'>;
    commentCounts: Fn<typeof ProjectTaskCommentActions, 'getTaskCommentCountsBatch'>;
    /** Kanban drag between status columns and list-row status changes. */
    updateStatus: Fn<typeof ProjectTaskActions, 'updateTaskStatus'>;
    reorder: Fn<typeof ProjectTaskActions, 'reorderTask'>;
    reorderInStatus: Fn<typeof ProjectTaskActions, 'reorderTasksInStatus'>;
    moveToPhase: Fn<typeof ProjectTaskActions, 'moveTaskToPhase'>;
    update: Fn<typeof ProjectTaskActions, 'updateTaskWithChecklist'>;
  };
  readonly options: {
    taskStatuses: Fn<typeof ProjectActions, 'getProjectTaskStatuses'>;
    statusesByPhase: Fn<typeof ProjectActions, 'getProjectStatusesByPhase'>;
    types: Fn<typeof ProjectTaskActions, 'getTaskTypes'>;
    tree: Fn<typeof ProjectActions, 'getProjectTreeData'>;
  };
  readonly phases: {
    customStatusCounts: Fn<typeof ProjectTaskStatusActions, 'getPhaseCustomStatusCounts'>;
    reorder: Fn<typeof ProjectActions, 'reorderPhase'>;
    update: Fn<typeof ProjectActions, 'updatePhase'>;
  };
  /**
   * The TaskForm submit in an admitted (non-native) mode. Native TaskForm keeps its own
   * submit path and never calls this; it exists on every implementation so the surface is
   * identical, and the native one forwards to `updateTaskWithChecklist`.
   */
  editTask(request: ProjectTaskEditRequest): Promise<ProjectTaskEditResult>;
  readonly screen: ProjectScreenBehavior;
}

/** Everything a form wants to change, as the form holds it. The data source decides what is admitted. */
export interface ProjectTaskEditRequest {
  taskId: string;
  /** Proposed values by `project_tasks` column name; only fields that differ from the loaded task. */
  changes: Record<string, unknown>;
  /** Client-generated per submit attempt, so a retry replays rather than double-applies. */
  operationId?: string;
}

export type ProjectTaskEditResult =
  | { ok: true; task: IProjectTask | null }
  /** Fields the screen cannot save. Nothing was written. Never silently dropped. */
  | { ok: false; code: 'refused'; refusedFields: string[] }
  | { ok: false; code: 'conflict'; task: IProjectTask | null }
  | { ok: false; code: 'invalid' | 'not_found' | 'failed'; message?: string };

export interface ProjectScreenSlots {
  /** L4c — task conversations in the drawer. `null` until a provider exists. */
  conversations: ((task: IProjectTask) => ReactNode) | null;
  /** L6a2 — effort/time summary in the drawer. `null` until a provider exists. */
  timeSummary: ((task: IProjectTask) => ReactNode) | null;
  /** Rendered by the drawer next to the form (assignment and history in shared mode). */
  taskAside: ((task: IProjectTask) => ReactNode) | null;
}

export interface ProjectScreenBehavior {
  /** No write of any kind is offered. */
  readOnly: boolean;
  /** Task fields rendered but disabled, with the reason. Column names of `project_tasks`. */
  frozenFields: readonly string[];
  /** Task fields not shared with this viewer; not rendered. */
  hiddenFields: readonly string[];
  hideCreate: boolean;
  hidePhaseMoves: boolean;
  hideKanbanDrag: boolean;
  /** Hide the project-level edit surface (ProjectInfo editing, status columns, tags). */
  freezeProjectEdit: boolean;
  /** Task submit goes through `editTask` (admitted) instead of the inline native path. */
  admittedTaskEdit: boolean;
  /** Where back/exit goes (the Shared Tasks queue in shared mode). */
  backHref: string | null;
  slots: ProjectScreenSlots;
}

export const NATIVE_PROJECT_SCREEN: ProjectScreenBehavior = Object.freeze({
  readOnly: false,
  frozenFields: Object.freeze([]) as readonly string[],
  hiddenFields: Object.freeze([]) as readonly string[],
  hideCreate: false,
  hidePhaseMoves: false,
  hideKanbanDrag: false,
  freezeProjectEdit: false,
  admittedTaskEdit: false,
  backHref: null,
  slots: Object.freeze({ conversations: null, timeSummary: null, taskAside: null }),
});

/** Every `project_tasks` field the task drawer renders; used to derive frozen sets. */
export const PROJECT_TASK_SCREEN_FIELDS = [
  'task_name', 'description', 'project_status_mapping_id', 'phase_id', 'assigned_to', 'assigned_team_id',
  'estimated_hours', 'start_date', 'due_date', 'priority_id', 'task_type_key', 'service_id',
  'checklist_items', 'tags', 'resources', 'dependencies', 'ticket_links',
] as const;
export type ProjectTaskScreenField = typeof PROJECT_TASK_SCREEN_FIELDS[number];

/** The structural surface of the seam: every callable path. The contract test compares implementations by this. */
export const PROJECT_DATA_SOURCE_METHODS = [
  'project.metadata', 'project.update',
  'tasks.data', 'tasks.forPhase', 'tasks.get', 'tasks.commentCounts', 'tasks.updateStatus', 'tasks.reorder',
  'tasks.reorderInStatus', 'tasks.moveToPhase', 'tasks.update',
  'options.taskStatuses', 'options.statusesByPhase', 'options.types', 'options.tree',
  'phases.customStatusCounts', 'phases.reorder', 'phases.update',
  'editTask',
] as const;
export type ProjectDataSourceMethod = typeof PROJECT_DATA_SOURCE_METHODS[number];

type Group = Record<string, (...args: any[]) => unknown>;

/** Resolves a dotted method path on a data source. */
export function projectDataSourceMethod(source: ProjectDataSource, path: ProjectDataSourceMethod): ((...args: any[]) => unknown) | undefined {
  const [head, tail] = path.split('.');
  const target = tail ? (source as unknown as Record<string, Group>)[head]?.[tail] : (source as unknown as Group)[head];
  return typeof target === 'function' ? target as (...args: any[]) => unknown : undefined;
}

/** Builds a data source from a base plus per-group overrides, merged one level deep. The result is a NEW object: build once. */
export type ProjectDataSourceOverrides = {
  [K in keyof ProjectDataSource]?: ProjectDataSource[K] extends object
    ? ProjectDataSource[K] extends (...args: any[]) => unknown ? ProjectDataSource[K] : Partial<ProjectDataSource[K]>
    : ProjectDataSource[K];
};

export function composeProjectDataSource(base: ProjectDataSource, overrides: ProjectDataSourceOverrides): ProjectDataSource {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const isGroup = typeof value === 'object' && value !== null && typeof baseValue === 'object' && baseValue !== null && !Array.isArray(value);
    merged[key] = isGroup && key !== 'screen' ? { ...(baseValue as object), ...(value as object) } : value;
  }
  return merged as unknown as ProjectDataSource;
}
