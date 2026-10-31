import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Alias lists a reader's redactions are matched against, one per display name. Single source for the project list, task list and assigned-task queue. */
export const CO_MANAGED_TASK_NAME_ALIASES = ['task_name', 'values.task_name', 'project_tasks.task_name', 'project_tasks', 'tasks'] as const;
export const CO_MANAGED_PROJECT_NAME_ALIASES = ['project_name', 'projectName', 'values.project_name', 'projects.project_name', 'project', 'project_id', 'projects'] as const;
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = ['client_name', 'organizationName', 'tenants'] as const;
/** The assignee display name; same aliases the ticket assignment surface uses for the assignee (users/teams are its sources). */
export const CO_MANAGED_ASSIGNEE_NAME_ALIASES = ['assignee_name', 'values.assignee_name', 'assignee', 'users', 'teams'] as const;

/**
 * Audit fields that carry a DERIVED display value: hiding the derived value's source hides the field too. A future audit
 * field that embeds a display name gets an entry here, not a special case in the reader.
 */
export const CO_MANAGED_AUDIT_DERIVED_ALIASES: Record<string, readonly string[]> = {
  msp_assignee: CO_MANAGED_ASSIGNEE_NAME_ALIASES,
};

/** Every alias a reader's redactions are matched against for one audit `changed_data` field. */
export function coManagedAuditFieldAliases(field: string): readonly string[] {
  // LEVERAGE: pattern co-managed-alias-lists — [field, values.field, table.field] is hand-built at several call sites (e.g. projectTaskAssignments.ts task_name/project_name checks).
  return [field, `values.${field}`, `project_tasks.${field}`, ...(Object.hasOwn(CO_MANAGED_AUDIT_DERIVED_ALIASES, field) ? CO_MANAGED_AUDIT_DERIVED_ALIASES[field] : [])];
}

/**
 * Applies the reader's redactions to an audit `changed_data` record. A hidden change is OMITTED, never nulled: a null in a
 * change record reads as "set to nothing", which would be a lie.
 */
export function projectCoManagedChanges(redactedFields: readonly string[], changedData: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changedData ?? {}).filter(([field]) => !isCoManagedReadFieldHidden(redactedFields, coManagedAuditFieldAliases(field))));
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
