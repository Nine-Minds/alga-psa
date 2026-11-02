import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import {
  CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  CO_MANAGED_ORGANIZATION_NAME_ALIASES,
  CO_MANAGED_PHASE_FIELD_SOURCE,
  CO_MANAGED_PROJECT_FIELD_SOURCE,
  CO_MANAGED_PROJECT_NAME_ALIASES,
  CO_MANAGED_TASK_FIELD_SOURCE,
  isCoManagedResourceHidden,
} from './sharedWorkProjection';

export type CoManagedProjectFamilyKind = 'project' | 'project_phase' | 'project_task';

/**
 * What a reader's redactions do to one project-family row, decided from the field-source descriptors so
 * project search, queues, editors and smart search hide the same canonical value. `dropRow`: the whole
 * resource or an identifier is hidden, so the row cannot be shown at all. `title`/`subtitle`/`body`: that
 * text is hidden (a hidden title is shown as the neutral title). A caller whose row is addressed and ordered
 * by index plumbing (the search index's link, parent and timestamps) passes those aliases as `indexPlumbing`;
 * hiding any of them, or the source table's own timestamps, drops the row too.
 */
export function coManagedProjectFamilyMask(redactedFields: readonly string[], kind: CoManagedProjectFamilyKind,
  indexPlumbing?: readonly string[]) {
  const isTask = kind === 'project_task', isPhase = kind === 'project_phase';
  const fields = isTask ? CO_MANAGED_TASK_FIELD_SOURCE : isPhase ? CO_MANAGED_PHASE_FIELD_SOURCE : CO_MANAGED_PROJECT_FIELD_SOURCE;
  const source = isTask ? 'project_tasks' : isPhase ? 'project_phases' : 'projects';
  const hidden = (names: readonly string[]) => isCoManagedReadFieldHidden(redactedFields, names);
  return {
    source,
    neutralTitle: isTask ? 'Project task' : isPhase ? 'Project phase' : 'Project',
    dropRow: isCoManagedResourceHidden(redactedFields, fields.resource)
      || hidden(indexPlumbing ? [...fields.identifier, ...indexPlumbing, `${source}.updated_at`, `${source}.created_at`] : fields.identifier),
    title: hidden(['title', ...fields.title]),
    subtitle: kind === 'project' || hidden(['subtitle', ...CO_MANAGED_PROJECT_NAME_ALIASES]),
    body: hidden(['body', ...fields.description]),
  };
}

/** True when a reader's redactions hide one plain column of a project-family table (`column`, `values.column`, `table.column`, plus any display-name aliases). */
export function coManagedColumnHidden(redactedFields: readonly string[], table: string, column: string,
  extraAliases: readonly string[] = []): boolean {
  return isCoManagedReadFieldHidden(redactedFields, [column, `values.${column}`, `${table}.${column}`, ...extraAliases]);
}

/** Extra display-name aliases per logical column, for columns that are derived or joined (the client name, the manager's name, a status name). */
export type CoManagedColumnSpec = Readonly<Record<string, readonly string[]>>;

/** The non-text `projects` columns (and their joined display values) a project list or candidate carries. */
export const CO_MANAGED_PROJECT_COLUMNS: CoManagedColumnSpec = {
  project_number: [], wbs_code: [], is_inactive: [], start_date: [], end_date: [], created_at: [], updated_at: [],
  budgeted_hours: [], client_portal_config: [], service_id: [], billing_profile_id: [],
  status: [], status_name: ['status'], is_closed: ['status'],
  client_id: [], client_name: [...CO_MANAGED_ORGANIZATION_NAME_ALIASES, 'client_id'],
  contact_name_id: [], contact_name: ['contact_name_id'],
  assigned_to: CO_MANAGED_ASSIGNEE_NAME_ALIASES, manager_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
};

/** The non-text `project_tasks` columns (and their joined display values) a candidate carries. */
export const CO_MANAGED_TASK_COLUMNS: CoManagedColumnSpec = {
  due_date: [], updated_at: [], status_name: ['status', 'project_status_mapping_id'], is_closed: ['status', 'project_status_mapping_id'],
  priority_name: ['priority_id', 'priority'], assigned_to_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
};

/** The logical columns of `spec` that the reader's redactions hide. */
export function coManagedHiddenColumns(redactedFields: readonly string[], table: string, spec: CoManagedColumnSpec): Set<string> {
  return new Set(Object.entries(spec)
    .filter(([column, aliases]) => coManagedColumnHidden(redactedFields, table, column, aliases))
    .map(([column]) => column));
}
