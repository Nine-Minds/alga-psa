import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** Alias lists a reader's redactions are matched against, one per display name. Single source for the project list, task list and assigned-task queue. */
/** The whole customer task resource; a reader who has either hidden may not read or write the task at all. */
export const CO_MANAGED_TASK_RESOURCE_ALIASES = ['tasks', 'project_tasks'] as const;
/** Whole-resource entries only (`*`, `fields`, exactly `tasks`/`project_tasks`, optionally `fields.`-prefixed); a nested path such as `project_tasks.task_name` is a per-field redaction and must not match. */
export const isCoManagedTaskResourceHidden = (redactedFields: readonly string[]): boolean => redactedFields.some(field => {
  if (typeof field !== 'string') throw new CoManagedSharedWorkError();
  return field === '*' || field === 'fields' || (CO_MANAGED_TASK_RESOURCE_ALIASES as readonly string[]).includes(field.startsWith('fields.') ? field.slice(7) : field);
});
export const CO_MANAGED_TASK_NAME_ALIASES = ['task_name', 'values.task_name', 'project_tasks.task_name', ...CO_MANAGED_TASK_RESOURCE_ALIASES] as const;
export const CO_MANAGED_PROJECT_NAME_ALIASES = ['project_name', 'projectName', 'values.project_name', 'projects.project_name', 'project', 'project_id', 'projects'] as const;
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = ['client_name', 'organizationName', 'tenants'] as const;
/** The assignee display name; same aliases the ticket assignment surface uses for the assignee (users/teams are its sources). */
export const CO_MANAGED_ASSIGNEE_NAME_ALIASES = ['assignee_name', 'values.assignee_name', 'assignee', 'users', 'teams'] as const;

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
