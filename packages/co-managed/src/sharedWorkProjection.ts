import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** Alias lists a reader's redactions are matched against, one per display name. Single source for the project list, task list and assigned-task queue. */
export const CO_MANAGED_TASK_NAME_ALIASES = ['task_name', 'values.task_name', 'project_tasks.task_name', 'project_tasks', 'tasks'] as const;
export const CO_MANAGED_PROJECT_NAME_ALIASES = ['project_name', 'projectName', 'values.project_name', 'projects.project_name', 'project', 'project_id', 'projects'] as const;
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = ['client_name', 'organizationName', 'tenants'] as const;
/** The assignee display name; same aliases the ticket assignment surface uses for the assignee (users/teams are its sources). */
export const CO_MANAGED_ASSIGNEE_NAME_ALIASES = ['assignee_name', 'values.assignee_name', 'assignee', 'users', 'teams'] as const;

export const CO_MANAGED_PHASE_NAME_ALIASES = ['phase_name', 'values.phase_name', 'project_phases.phase_name', 'phaseName'] as const;

/**
 * Where one searchable kind's fields come from: the aliases that hide the whole resource, its title, its description and the
 * identifiers that locate it. Project search masks from these, so search, queues and editors hide the same canonical value.
 */
export interface CoManagedFieldSource {
  readonly resource: readonly string[]; readonly title: readonly string[];
  readonly description: readonly string[]; readonly identifier: readonly string[];
}
/** How every searchable kind refers to its project; hiding the reference hides the row. */
const PROJECT_REFERENCE_ALIASES = ['project', 'projectId', 'project_id', 'projects.project_id'] as const;
export const CO_MANAGED_PROJECT_FIELD_SOURCE: CoManagedFieldSource = {
  resource: ['projects'], title: CO_MANAGED_PROJECT_NAME_ALIASES, description: ['description', 'values.description', 'projects.description'],
  identifier: ['project_id', 'projects.project_id', ...PROJECT_REFERENCE_ALIASES],
};
export const CO_MANAGED_PHASE_FIELD_SOURCE: CoManagedFieldSource = {
  resource: ['project_phases'], title: CO_MANAGED_PHASE_NAME_ALIASES, description: ['description', 'values.description', 'project_phases.description'],
  identifier: ['phase_id', 'project_phases.phase_id', ...PROJECT_REFERENCE_ALIASES],
};
export const CO_MANAGED_TASK_FIELD_SOURCE: CoManagedFieldSource = {
  resource: ['tasks', 'project_tasks'], title: CO_MANAGED_TASK_NAME_ALIASES, description: ['description', 'values.description', 'project_tasks.description', 'tasks.description'],
  identifier: ['task_id', 'taskId', 'project_tasks.task_id', 'tasks.task_id', ...PROJECT_REFERENCE_ALIASES],
};

/**
 * True when a redaction names the whole resource itself (or everything). Unlike `isCoManagedReadFieldHidden` this does not
 * treat `tasks.description` as hiding `tasks`: a field-level redaction must not drop the resource.
 */
export function isCoManagedResourceHidden(redactions: readonly string[], resource: readonly string[]): boolean {
  return redactions.some(field => {
    if (typeof field !== 'string') throw new CoManagedSharedWorkError();
    if (field === '*' || field === 'fields') return true;
    return resource.includes(field.startsWith('fields.') ? field.slice(7) : field);
  });
}

export type CoManagedSnapshotSpec<Row> = { [Field in keyof Row]?: readonly string[] };
export type CoManagedMaskedSnapshot<Row, Spec> = { [Field in keyof Row]: Field extends keyof Spec ? Row[Field] | null : Row[Field] };

/**
 * Applies the reader's CURRENT redactions to a snapshot row. `spec` maps each snapshot field to the aliases that hide it;
 * a hidden field is set to null (never dropped from the object, never inferred from a sibling), all other fields pass through.
 *
 * Two deliberate behaviours exist side by side:
 * - The assigned-task queue NULLS hidden names, because the assignment itself is the fact being shown. Dropping the row
 *   would hide work from the person it is assigned to.
 * - `listCoManagedSharedProjectTasks` keeps returning no rows when `task_name` is hidden, because a task with no name
 *   cannot be listed there.
 */
export function maskCoManagedSnapshot<Row extends object, Spec extends CoManagedSnapshotSpec<Row>>(
  redactedFields: readonly string[], row: Row, spec: Spec): CoManagedMaskedSnapshot<Row, Spec> {
  const masked: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of Object.keys(spec)) {
    const aliases = spec[field as keyof Spec] as readonly string[] | undefined;
    if (aliases && isCoManagedReadFieldHidden(redactedFields, aliases)) masked[field] = null;
  }
  return masked as CoManagedMaskedSnapshot<Row, Spec>;
}
