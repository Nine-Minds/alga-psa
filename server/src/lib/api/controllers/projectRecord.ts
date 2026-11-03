import { isCoManagedReadFieldHidden } from '@alga-psa/co-managed/sharedWorkRedaction';
import { isCoManagedResourceHidden } from '@alga-psa/co-managed/sharedWorkProjection';

const PROJECT_RESOURCE_ALIASES = ['project', 'projects'] as const;
const PROJECT_IDENTIFIER_ALIASES = [
  'project_id', 'projectId', 'projects.project_id',
  'project_number', 'projects.project_number',
] as const;

const DERIVED_FIELD_SOURCES: Record<string, readonly string[]> = {
  client_name: ['client_name', 'client_id', 'clients.client_name'],
  status_name: [
    'status_name', 'status', 'projects.status', 'statuses', 'statuses.name',
    'standard_statuses', 'standard_statuses.name', 'project_status_mapping_id',
    'project_status_mappings', 'project_status_mappings.custom_name',
  ],
  assigned_user_name: ['assigned_user_name', 'assigned_to', 'users', 'users.first_name', 'users.last_name'],
  contact_name: ['contact_name', 'contact_name_id', 'contacts', 'contacts.full_name'],
};

function fieldSources(field: string): string[] {
  const derived = DERIVED_FIELD_SOURCES[field];
  if (derived) return [field, ...derived, `values.${field}`];
  return [field, `values.${field}`, `projects.${field}`];
}

/** Project a REST project row through the authorization kernel's field policy. */
export function projectRecord<T extends Record<string, any>>(
  record: T,
  redactedFields: readonly string[],
): Partial<T> | null {
  if (isCoManagedResourceHidden(redactedFields, PROJECT_RESOURCE_ALIASES)) return null;
  if (isCoManagedReadFieldHidden(redactedFields, PROJECT_IDENTIFIER_ALIASES)) return null;

  const projected: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (!isCoManagedReadFieldHidden(redactedFields, fieldSources(field))) {
      projected[field] = value;
    }
  }
  return projected as Partial<T>;
}
