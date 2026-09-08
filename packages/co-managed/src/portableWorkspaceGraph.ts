import { validateCoManagedPortableCoreRecords, CO_MANAGED_PORTABLE_CORE_REFERENCES } from './portableCoreExport';
import { validateCoManagedPortableWorkRecords, CO_MANAGED_PORTABLE_WORK_REFERENCES } from './portableWorkExport';
import { validateCoManagedPortableDocumentRecords, CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES } from './portableDocumentExport';
import { validateCoManagedPortableAssetRecords, CO_MANAGED_PORTABLE_ASSET_REFERENCES } from './portableAssetExport';
import { validateCoManagedPortableOperationalRecords, CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES, CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES } from './portableOperationalExport';
import { validateCoManagedPortableWorkflowRecords, CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES, CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES } from './portableWorkflowExport';
import { validateCoManagedPortableEngagementRecords, CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES } from './portableEngagementExport';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { validatePortableRecordReferences, type PortableRecords, type PortableRecordReference } from './portableRecordValidation';

const validators = {
  core: validateCoManagedPortableCoreRecords, work: validateCoManagedPortableWorkRecords, documents: validateCoManagedPortableDocumentRecords,
  assets: validateCoManagedPortableAssetRecords, operational: validateCoManagedPortableOperationalRecords,
  workflows: validateCoManagedPortableWorkflowRecords, engagement: validateCoManagedPortableEngagementRecords,
};
export type CoManagedPortableRecordSections = Record<keyof typeof validators, PortableRecords>;

// Restore dependencies omitted from early individual components. This catalog
// is trusted application metadata, never declarations accepted from an archive.
export const CO_MANAGED_PORTABLE_ADDITIONAL_REFERENCES: readonly PortableRecordReference[] = [
  ['boards', 'default_assigned_to', 'users', 'user_id'], ['boards', 'manager_user_id', 'users', 'user_id'],
  ['boards', 'default_assigned_team_id', 'teams', 'team_id'], ['boards', 'default_priority_id', 'priorities', 'priority_id'],
  ['boards', 'sla_policy_id', 'sla_policies', 'sla_policy_id'], ['boards', 'inbound_reply_reopen_status_id', 'statuses', 'status_id'],
  ...['statuses', 'priorities', 'categories', 'severities', 'urgencies', 'impacts', 'comment_threads', 'ticket_checklist_items'].map(table => [table, 'created_by', 'users', 'user_id'] as const),
  ...['entered_by', 'updated_by', 'assigned_to', 'closed_by', 'escalated_by'].map(column => ['tickets', column, 'users', 'user_id'] as const),
  ['tickets', 'assigned_team_id', 'teams', 'team_id'], ['tickets', 'sla_policy_id', 'sla_policies', 'sla_policy_id'],
  ...['ticket_resources', 'task_resources'].flatMap(table => ['assigned_to', 'additional_user_id'].map(column => [table, column, 'users', 'user_id'] as const)),
  ['comments', 'user_id', 'users', 'user_id'], ['comments', 'contact_id', 'contacts', 'contact_name_id'],
  ['comment_reactions', 'user_id', 'users', 'user_id'], ['ticket_audit_logs', 'actor_user_id', 'users', 'user_id'],
  ['ticket_audit_logs', 'actor_contact_id', 'contacts', 'contact_name_id'], ['ticket_audit_logs', 'actor_reference_id', 'collaboration_actor_references', 'actor_reference_id'],
  ...['board_id', 'category_id', 'subcategory_id', 'priority_id'].map(column => ['checklist_template_apply_rules', column,
    column === 'board_id' ? 'boards' : column === 'priority_id' ? 'priorities' : 'categories', column === 'subcategory_id' ? 'category_id' : column] as const),
  ['ticket_checklist_items', 'assigned_to', 'users', 'user_id'], ['ticket_checklist_items', 'completed_by', 'users', 'user_id'],
  ['ticket_checklist_items', 'template_id', 'checklist_templates', 'template_id'],
  ['projects', 'assigned_to', 'users', 'user_id'], ['projects', 'contact_name_id', 'contacts', 'contact_name_id'],
  ['project_tasks', 'assigned_to', 'users', 'user_id'], ['project_tasks', 'assigned_team_id', 'teams', 'team_id'],
  ['project_tasks', 'status_id', 'statuses', 'status_id'], ['task_checklist_items', 'assigned_to', 'users', 'user_id'],
  ['project_task_comments', 'user_id', 'users', 'user_id'], ['project_task_comment_reactions', 'user_id', 'users', 'user_id'],
  ...['user_id', 'created_by', 'edited_by'].map(column => ['documents', column, 'users', 'user_id'] as const),
  // documents.source_template_id is inert render provenance (standard code or historical UUID), not a live template FK.
  ['document_versions', 'created_by', 'users', 'user_id'],
  ['document_content', 'created_by_id', 'users', 'user_id'], ['document_content', 'updated_by_id', 'users', 'user_id'],
  ['document_folders', 'created_by', 'users', 'user_id'],
  ...['created_by', 'updated_by'].map(column => ['document_default_folders', column, 'users', 'user_id'] as const),
  ['document_template_assignments', 'template_id', 'document_templates', 'template_id'], ['document_template_assignments', 'created_by', 'users', 'user_id'],
  ...['last_reviewed_by', 'created_by', 'updated_by', 'published_by'].map(column => ['kb_articles', column, 'users', 'user_id'] as const),
  ['kb_articles', 'category_id', 'categories', 'category_id'], ['kb_article_relations', 'created_by', 'users', 'user_id'],
  ['kb_article_reviewers', 'user_id', 'users', 'user_id'], ['kb_article_reviewers', 'assigned_by', 'users', 'user_id'],
  ...['created_by', 'updated_by'].map(column => ['kb_article_templates', column, 'users', 'user_id'] as const),
];

/** Assembles strictly known record sections and validates scalar dependencies
 * against the complete included record set. This neither authenticates a
 * container nor validates blob bindings, arbitrary embedded JSON or live trust. */
export function validateCoManagedPortableWorkspaceRecords(input: unknown, options: { sourceTenant: string }) {
  if (!isCoManagedUuid(options?.sourceTenant)) throw new Error('Portable workspace identity is required');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== Object.keys(validators).length ||
      Object.keys(validators).some(key => !Object.hasOwn(input, key))) throw new Error('Incomplete portable workspace sections');
  const sections = input as CoManagedPortableRecordSections, records: PortableRecords = {};
  for (const section of Object.keys(validators) as (keyof typeof validators)[]) {
    const validate: (value: unknown) => void = validators[section];
    validate(sections[section]);
    for (const [table, rows] of Object.entries(sections[section])) {
      if (Object.hasOwn(records, table)) throw new Error('Duplicate portable workspace table');
      records[table] = rows;
    }
  }
  const references: readonly PortableRecordReference[] = [...CO_MANAGED_PORTABLE_CORE_REFERENCES, ...CO_MANAGED_PORTABLE_WORK_REFERENCES,
    ...CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES, ...CO_MANAGED_PORTABLE_ASSET_REFERENCES, ...CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES,
    ...CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES, ...CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES, ...CO_MANAGED_PORTABLE_ADDITIONAL_REFERENCES];
  validatePortableRecordReferences(records, references, CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES);
  validateConditionalGraph(records, options.sourceTenant);
  return { records, references, referenceValueTypes: CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES };
}


const entityTargets: Record<string, readonly [string, string]> = {
  user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'], contact: ['contacts', 'contact_name_id'],
  ticket: ['tickets', 'ticket_id'], project: ['projects', 'project_id'], project_task: ['project_tasks', 'task_id'],
  asset: ['assets', 'asset_id'], document: ['documents', 'document_id'],
};
function validateConditionalGraph(records: PortableRecords, sourceTenant: string) {
  const indexes = new Map<string, Set<unknown>>();
  const target = (value: unknown, table: string, column: string, text = false) => {
    if ((!text && !isCoManagedUuid(value)) || (text && (typeof value !== 'string' || !value))) throw new Error('Invalid portable conditional reference');
    const key = JSON.stringify([table, column, text]);
    let ids = indexes.get(key);
    if (!ids) {
      if (!Object.hasOwn(records, table)) throw new Error('Portable conditional section is missing');
      ids = new Set(records[table].map(row => text ? row[column] : String(row[column]).toLowerCase())); indexes.set(key, ids);
    }
    if (!ids.has(text ? value : String(value).toLowerCase())) throw new Error('Portable conditional reference is missing');
  };
  for (const source of CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES) {
    for (const row of records[source.table]) {
      const parent = (source.targets as Record<string, readonly [string, string] | null>)[String(row[source.discriminator])];
      if (parent) target(row[source.column], ...parent);
    }
  }
  for (const table of ['asset_associations', 'document_associations', 'document_folders']) {
    for (const row of records[table]) {
      if (table === 'document_folders' && row.entity_id === null && row.entity_type === null) continue;
      if (row.entity_type === 'tenant') {
        if (!isCoManagedUuid(row.entity_id) || row.entity_id.toLowerCase() !== sourceTenant.toLowerCase()) throw new Error('Portable workspace association is foreign');
        continue;
      }
      const parent = entityTargets[String(row.entity_type)];
      if (!parent) throw new Error('Portable association requires an unsupported record section');
      target(row.entity_id, ...parent);
    }
  }
  for (const row of records.document_template_assignments) {
    if (row.scope_type === 'client') target(row.scope_id, 'clients', 'client_id');
    else if (row.scope_type !== 'tenant' || row.scope_id !== null) throw new Error('Invalid portable template scope');
  }
  for (const row of records.workflow_task_definitions) if (row.form_type === 'tenant' && row.form_id !== null) target(row.form_id, 'workflow_form_definitions', 'form_id', true);
  for (const row of records.workflow_form_definitions) if (isCoManagedUuid(row.created_by)) target(row.created_by, 'users', 'user_id');
  for (const row of records.availability_settings) {
    const config = row.config_json as Record<string, unknown> | null;
    if (!config) continue;
    for (const [field, table, column] of [['approver_user_ids', 'users', 'user_id'], ['approver_team_ids', 'teams', 'team_id']] as const) {
      for (const id of (config[field] ?? []) as unknown[]) target(id, table, column);
    }
    if (config.default_approver_id != null) target(config.default_approver_id, 'users', 'user_id');
  }
}
