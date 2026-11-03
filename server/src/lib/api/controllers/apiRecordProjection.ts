import { isCoManagedReadFieldHidden } from '@alga-psa/co-managed/sharedWorkRedaction';
import { isCoManagedResourceHidden } from '@alga-psa/co-managed/sharedWorkProjection';
import { CO_MANAGED_PROJECT_NAME_ALIASES } from '@alga-psa/co-managed/sharedWorkProjection';

type ResourceDefinition = {
  aliases: readonly string[];
  identifiers: readonly string[];
  fields: Readonly<Record<string, readonly string[]>>;
};

const commonClientName = ['client_name', 'clientName', 'client_id', 'clients', 'clients.client_name', 'values.client_id', 'projects.client_id', 'tickets.client_id', 'quotes.client_id', 'assets.client_id'] as const;
const commonAssignedName = ['assigned_user_name', 'assigned_to_name', 'assigned_to', 'users', 'users.first_name', 'users.last_name', 'values.assigned_to', 'projects.assigned_to', 'tickets.assigned_to', 'assets.assigned_to'] as const;
const commonStatusName = ['status_name', 'status', 'status_id', 'status_is_closed', 'statuses', 'statuses.name', 'statuses.is_closed', 'projects.status', 'tickets.status', 'tickets.status_id'] as const;

const DEFINITIONS: Record<'project' | 'ticket' | 'quote' | 'asset', ResourceDefinition> = {
  project: {
    aliases: ['project', 'projects'],
    identifiers: ['project_id', 'projectId', 'projects.project_id', 'values.project_id', 'id', 'project_number', 'projects.project_number'],
    fields: {
      project_name: [...CO_MANAGED_PROJECT_NAME_ALIASES.filter((alias) => !['project', 'project_id', 'projects'].includes(alias)), 'values.project_name', 'projects.project_name'],
      projectName: [...CO_MANAGED_PROJECT_NAME_ALIASES.filter((alias) => !['project', 'project_id', 'projects'].includes(alias)), 'values.project_name', 'projects.project_name'],
      client_name: commonClientName,
      clientName: commonClientName,
      status_name: [...commonStatusName, 'standard_statuses', 'standard_statuses.name', 'project_status_mapping_id', 'project_status_mappings', 'project_status_mappings.custom_name'],
      assigned_user_name: commonAssignedName,
      contact_name: ['contact_name', 'contact_name_id', 'contacts', 'contacts.full_name', 'values.contact_name_id', 'projects.contact_name_id'],
    },
  },
  ticket: {
    aliases: ['ticket', 'tickets'],
    identifiers: ['ticket_id', 'tickets.ticket_id', 'values.ticket_id', 'ticket_number', 'tickets.ticket_number'],
    fields: {
      client_name: commonClientName,
      clientName: commonClientName,
      status_name: [...commonStatusName, 'standard_statuses', 'standard_statuses.name'],
      status_is_closed: commonStatusName,
      priority_name: ['priority_name', 'priority_id', 'priorities', 'priorities.priority_name'],
      category_name: ['category_name', 'category_id', 'categories', 'categories.category_name'],
      subcategory_name: ['subcategory_name', 'subcategory_id', 'subcategories', 'subcategories.category_name'],
      board_name: ['board_name', 'board_id', 'boards', 'boards.board_name'],
      assigned_to_name: commonAssignedName,
      assigned_user_name: commonAssignedName,
      entered_by_name: ['entered_by_name', 'entered_by', 'values.entered_by', 'users', 'users.first_name', 'users.last_name'],
      created_by_full_name: ['created_by_full_name', 'created_by', 'entered_by', 'values.created_by', 'users', 'users.first_name', 'users.last_name'],
      contact_name: ['contact_name', 'contact_name_id', 'contacts', 'contacts.full_name', 'values.contact_name_id', 'tickets.contact_name_id'],
      location_name: ['location_name', 'location_id', 'locations', 'locations.location_name'],
      bundle_master_ticket_number: ['bundle_master_ticket_number', 'master_ticket_id', 'tickets.ticket_number'],
    },
  },
  quote: {
    aliases: ['quote', 'quotes', 'billing'],
    identifiers: ['quote_id', 'quotes.quote_id', 'values.quote_id', 'quote_number', 'quotes.quote_number'],
    fields: {
      client_name: commonClientName,
      clientName: commonClientName,
      display_quote_number: ['display_quote_number', 'quote_number', 'version', 'quote_id', 'quotes.quote_number'],
      quote_items: ['quote_items', 'quotes.quote_items'],
    },
  },
  asset: {
    aliases: ['asset', 'assets'],
    identifiers: ['asset_id', 'assets.asset_id', 'values.asset_id', 'asset_tag', 'assets.asset_tag'],
    fields: {
      client_name: commonClientName,
      clientName: commonClientName,
      assigned_user_name: commonAssignedName,
      asset_type_name: ['asset_type_name', 'asset_type_id', 'asset_types', 'asset_types.name'],
      location_name: ['location_name', 'location_id', 'locations', 'locations.location_name'],
    },
  },
};

function fieldAliases(resource: keyof typeof DEFINITIONS, field: string): readonly string[] {
  const definition = DEFINITIONS[resource];
  const dependencies = definition.fields[field] ?? [];
  const dependencyAliases = dependencies.flatMap((alias) => alias.includes('.')
    ? [alias]
    : [alias, `values.${alias}`, `${definition.aliases[1]}.${alias}`]);
  return [...new Set([field, `values.${field}`, `${definition.aliases[1]}.${field}`, ...dependencyAliases])];
}

export function isApiRecordFieldHidden(resource: keyof typeof DEFINITIONS, field: string, redactedFields: readonly string[]): boolean {
  return isCoManagedReadFieldHidden(redactedFields, fieldAliases(resource, field));
}

export function areApiRecordFieldsVisible(resource: keyof typeof DEFINITIONS, fields: readonly string[], redactedFields: readonly string[]): boolean {
  return fields.every((field) => !isApiRecordFieldHidden(resource, field, redactedFields));
}

/** Apply resource and relation-aware redactions before an API record is serialized. */
export function projectApiRecord<T extends Record<string, any>>(
  resource: keyof typeof DEFINITIONS,
  record: T,
  redactedFields: readonly string[],
): Partial<T> | null {
  const definition = DEFINITIONS[resource];
  if (isCoManagedResourceHidden(redactedFields, definition.aliases)) return null;
  if (isCoManagedReadFieldHidden(redactedFields, definition.identifiers)) return null;

  const projected: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    if (!isApiRecordFieldHidden(resource, field, redactedFields)) {
      projected[field] = projectNestedValue(resource, value, field, redactedFields);
    }
  }
  return projected as Partial<T>;
}

function projectNestedValue(
  resource: keyof typeof DEFINITIONS,
  value: unknown,
  parentPath: string,
  redactedFields: readonly string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => projectNestedValue(resource, item, parentPath, redactedFields));
  }
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  return Object.fromEntries(Object.entries(value).flatMap(([field, nestedValue]) => {
    const path = `${parentPath}.${field}`;
    if (isCoManagedReadFieldHidden(redactedFields, [path, ...fieldAliases(resource, path)])) return [];
    return [[field, projectNestedValue(resource, nestedValue, path, redactedFields)]];
  }));
}
