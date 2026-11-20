import {
  PHASE_NAME_ALIASES,
  PROJECT_NAME_ALIASES,
  TASK_NAME_ALIASES,
  TASK_RESOURCE_ALIASES,
  isResourceHidden,
} from '@alga-psa/authorization/recordProjection';
import { isCoManagedReadFieldHidden, withCoManagedRedactionError } from './sharedWorkRedaction';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { coManagedConversationAuthorSources, coManagedConversationBodySources } from './conversationPolicy';

/** Alias lists a reader's redactions are matched against, one per display name. Single source for the project list, task list and assigned-task queue. */
/** The whole customer task resource; a reader who has either hidden may not read or write the task at all. */
export const CO_MANAGED_TASK_RESOURCE_ALIASES = TASK_RESOURCE_ALIASES;
/** Whole-resource entries only (`*`, `fields`, exactly `tasks`/`project_tasks`, optionally `fields.`-prefixed); a nested path such as `project_tasks.task_name` is a per-field redaction and must not match. */
export const isCoManagedTaskResourceHidden = (redactedFields: readonly string[]): boolean => redactedFields.some(field => {
  if (typeof field !== 'string') throw new CoManagedSharedWorkError();
  return field === '*' || field === 'fields' || (CO_MANAGED_TASK_RESOURCE_ALIASES as readonly string[]).includes(field.startsWith('fields.') ? field.slice(7) : field);
});
export const CO_MANAGED_TASK_NAME_ALIASES = TASK_NAME_ALIASES;
export const CO_MANAGED_PROJECT_NAME_ALIASES = PROJECT_NAME_ALIASES;
/** Every spelling the organization's display name is stored, queried or projected under: the snapshot column, the raw provider value, the live `tenants.client_name` read and the response key. */
export const CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES = [
  'organization_name', 'values.organization_name',
  'client_name', 'organizationName', 'tenants',
  'organizations.organization_name', 'project_tasks.organization_name',
  'co_managed_project_task_references.organization_name',
] as const;
/** The organization name's aliases; one set drives both the cached-reference mask and the live `readCoManagedCustomerOrganizationName` check. */
export const CO_MANAGED_ORGANIZATION_NAME_ALIASES = CO_MANAGED_ORGANIZATION_NAME_FIELD_NAMES;
/** The assignee display name; same aliases the ticket assignment surface uses for the assignee (users/teams are its sources). */
export const CO_MANAGED_ASSIGNEE_NAME_ALIASES = ['assignee_name', 'values.assignee_name', 'assignee', 'users', 'teams'] as const;
/** Reader aliases for stored values whose source is represented by a derived display field. */
export const CO_MANAGED_STORED_FIELD_ALIASES: Record<string, readonly string[]> = {
  msp_assignee: CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  project_status_mapping_id: ['status', 'status_name', 'status_id', 'selectedStatus', 'statuses', 'standard_statuses', 'custom_name', 'project_status_mappings'],
};

export const CO_MANAGED_PHASE_NAME_ALIASES = PHASE_NAME_ALIASES;

const CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES = [...coManagedConversationBodySources, 'comments', 'comment', 'comment_content', 'comments.content', 'comment_threads', 'ticket_conversation'] as const;
const CO_MANAGED_NOTIFICATION_AUTHOR_ALIASES = [...coManagedConversationAuthorSources, 'author_name', 'comments.author'] as const;
/** Source aliases belong to the value, so every composite inherits the same redactions. */
const CO_MANAGED_NOTIFICATION_SOURCES = {
  ticketTitle: ['title', 'ticket_title', 'tickets.title', 'ticket.title', 'tickets'],
  ticketNumber: ['ticket_number', 'tickets.ticket_number', 'tickets'],
  requesterName: ['requester', 'requester_name', 'contact_name', 'contacts', 'tickets.contact_name_id'],
  requesterEmail: ['requester', 'requester_email', 'contact_email', 'contacts', 'tickets.contact_name_id'],
  requesterPhone: ['requester', 'requester_phone', 'contact_phone', 'contacts', 'tickets.contact_name_id'],
  assignedToName: ['assigned_to', 'assigned_to_name', 'tickets.assigned_to', 'tickets.assigned_team_id', ...CO_MANAGED_ASSIGNEE_NAME_ALIASES],
  assignedToEmail: ['assigned_to_email', 'assignee_email', 'assignee', 'assigned_to', 'users', 'teams', 'tickets.assigned_to', 'tickets.assigned_team_id'],
  clientName: CO_MANAGED_ORGANIZATION_NAME_ALIASES,
  locationSummary: ['location', 'location_name', 'locations', 'address_line1', 'address_line2', 'city', 'state_province', 'postal_code', 'country_code', ...CO_MANAGED_ORGANIZATION_NAME_ALIASES],
  // Interactive conversation reads hide the whole author reference when any author source is hidden.
  actorName: [...CO_MANAGED_NOTIFICATION_AUTHOR_ALIASES, 'assigned_to', 'assigned_to_name', ...CO_MANAGED_ASSIGNEE_NAME_ALIASES],
  authorName: CO_MANAGED_NOTIFICATION_AUTHOR_ALIASES,
  actorOrganization: [...CO_MANAGED_NOTIFICATION_AUTHOR_ALIASES, ...CO_MANAGED_ORGANIZATION_NAME_ALIASES],
  priority: ['priority', 'priority_id', 'priority_name', 'tickets.priority_id', 'priorities'],
  status: ['status', 'status_id', 'status_name', 'tickets.status_id', 'statuses'],
  board: ['board', 'board_id', 'board_name', 'tickets.board_id', 'boards'],
  category: ['category', 'categories', 'category_id', 'category_name', 'tickets.category_id'],
  subcategory: ['subcategory', 'subcategory_id', 'subcategory_name', 'tickets.subcategory_id', 'subcategories'],
  ticketUrl: ['tickets', 'ticket_id', 'tickets.ticket_id'],
  description: ['description', 'tickets.description', 'ticket_description', 'attributes.description', 'tickets.attributes.description'],
} as const;
const CO_MANAGED_NOTIFICATION_SNAPSHOT_SPEC = {
  ...CO_MANAGED_NOTIFICATION_SOURCES,
  requesterContact: [...CO_MANAGED_NOTIFICATION_SOURCES.requesterEmail, ...CO_MANAGED_NOTIFICATION_SOURCES.requesterPhone],
  requesterDetails: [...CO_MANAGED_NOTIFICATION_SOURCES.requesterName, ...CO_MANAGED_NOTIFICATION_SOURCES.requesterEmail, ...CO_MANAGED_NOTIFICATION_SOURCES.requesterPhone],
  assignedDetails: [...CO_MANAGED_NOTIFICATION_SOURCES.assignedToName, ...CO_MANAGED_NOTIFICATION_SOURCES.assignedToEmail],
  categoryDetails: [...CO_MANAGED_NOTIFICATION_SOURCES.category, ...CO_MANAGED_NOTIFICATION_SOURCES.subcategory],
  metaLine: [...CO_MANAGED_NOTIFICATION_SOURCES.ticketNumber, ...CO_MANAGED_NOTIFICATION_SOURCES.priority, ...CO_MANAGED_NOTIFICATION_SOURCES.status],
  priorityColor: CO_MANAGED_NOTIFICATION_SOURCES.priority,
  commentContent: CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES,
  commentPreview: CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES,
  commentHtml: CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES,
  commentRawContent: CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES,
} as const;

/** Canonical notification projection shared by routing and comment delivery adapters. */
export function projectCoManagedNotificationSnapshot<Row extends object>(redactedFields: readonly string[], row: Row) {
  const snapshot = maskCoManagedSnapshot(redactedFields, row, CO_MANAGED_NOTIFICATION_SNAPSHOT_SPEC as any);
  return { ...snapshot, conversationSuppressed: isCoManagedReadFieldHidden(redactedFields, CO_MANAGED_NOTIFICATION_CONVERSATION_ALIASES) };
}

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
  return withCoManagedRedactionError(() => isResourceHidden(redactions, resource));
}

/**
 * Audit fields that carry a DERIVED display value: hiding the derived value's source hides the field too. A future audit
 * field that embeds a display name gets an entry here, not a special case in the reader.
 */
export const CO_MANAGED_AUDIT_DERIVED_ALIASES = CO_MANAGED_STORED_FIELD_ALIASES;

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
 *   cannot be listed there. Its per-task assignment reference is masked the same way as the queue: a hidden assignee
 *   name is nulled while `revision` and `assignedToMe` (the fact that it is assigned) still come through.
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
