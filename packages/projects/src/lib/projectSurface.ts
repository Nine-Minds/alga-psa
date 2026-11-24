import {
  NATIVE_PROJECT_SCREEN,
  PROJECT_TASK_SCREEN_FIELDS,
  type ProjectDataSource,
  type ProjectScreenBehavior,
} from './projectDataSource';

/**
 * What the server closes on the project screen for the signed-in user, as data (`resolveResourceSurface` for the
 * `project` resource: the columns its reads leave out and the operations no action covers). The host page reads it
 * once and passes it down, so a closed control is never rendered and then removed. Empty for everyone the kernel
 * governs nothing for, which is every MSP user: their screen is the native one, the same object.
 */
export interface ProjectSurfaceAccess {
  closedFields: readonly string[];
  closedOperations: readonly string[];
}

export const OPEN_PROJECT_SURFACE: ProjectSurfaceAccess = Object.freeze({
  closedFields: Object.freeze([]) as readonly string[],
  closedOperations: Object.freeze([]) as readonly string[],
});

/** The one place a closed project column becomes a form field that is not rendered. */
const FORM_FIELD_BY_CLOSED_COLUMN: Readonly<Record<string, string>> = Object.freeze({ service_id: 'service_id' });

/**
 * Task fields a viewer who may not manage the project still changes: the work's status, who has it, its checklist, and
 * the existing tags applied to it (what the tag actions let them write: they apply and remove, they never define).
 * Everything else on the task form is rendered but frozen. The server refuses the same writes
 * (`GOVERNED_TASK_WRITABLE_FIELDS`), so this is the screen telling the truth, not the control.
 */
export const MANAGE_CLOSED_WRITABLE_TASK_FIELDS: readonly string[] = Object.freeze([
  'project_status_mapping_id', 'assigned_to', 'checklist_items', 'tags',
]);

export function isProjectSurfaceOpen(access: ProjectSurfaceAccess): boolean {
  return access.closedFields.length === 0 && access.closedOperations.length === 0;
}

/** The screen behaviour for a surface: the native screen when nothing is closed, and otherwise the native screen narrowed. */
export function projectScreenForSurface(access: ProjectSurfaceAccess): ProjectScreenBehavior {
  if (isProjectSurfaceOpen(access)) return NATIVE_PROJECT_SCREEN;
  const manageClosed = access.closedOperations.includes('project_manage');
  const hidden = access.closedFields.flatMap((column) => FORM_FIELD_BY_CLOSED_COLUMN[column] ?? []);
  return Object.freeze({
    ...NATIVE_PROJECT_SCREEN,
    hiddenFields: Object.freeze([...NATIVE_PROJECT_SCREEN.hiddenFields, ...hidden]),
    closedOperations: Object.freeze([...access.closedOperations]),
    ...(manageClosed ? {
      frozenFields: Object.freeze(PROJECT_TASK_SCREEN_FIELDS.filter((field) => !MANAGE_CLOSED_WRITABLE_TASK_FIELDS.includes(field))),
      hideCreate: true,
      hidePhaseMoves: true,
      freezeProjectEdit: true,
      // The form sends only the fields that changed, through the data source, so a frozen field is never sent back.
      admittedTaskEdit: true,
    } : {}),
  });
}

const sources = new WeakMap<ProjectDataSource, Map<string, ProjectDataSource>>();

/**
 * The data source for a surface. An open surface returns `base` itself (identity, so the MSP screen mounts exactly
 * what it did before and no effect re-runs); a narrowed one returns a source with the same actions and the narrowed
 * screen. Built once per (base, surface): the result is a context value and must not change identity per render.
 */
export function projectDataSourceForSurface(base: ProjectDataSource, access: ProjectSurfaceAccess): ProjectDataSource {
  if (isProjectSurfaceOpen(access)) return base;
  const key = JSON.stringify([[...access.closedFields].sort(), [...access.closedOperations].sort()]);
  let byKey = sources.get(base);
  if (!byKey) sources.set(base, (byKey = new Map()));
  let source = byKey.get(key);
  if (!source) byKey.set(key, (source = Object.freeze({ ...base, screen: projectScreenForSurface(access) }) as ProjectDataSource));
  return source;
}

/** Whether the screen may call or offer `operation`. A screen that names no closed operations offers every one. */
export function projectScreenOffers(screen: Pick<ProjectScreenBehavior, 'closedOperations'>, operation: string): boolean {
  return !(screen.closedOperations?.includes(operation) ?? false);
}
