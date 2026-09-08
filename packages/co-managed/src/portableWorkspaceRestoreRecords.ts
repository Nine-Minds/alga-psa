import { CO_MANAGED_PORTABLE_CORE_COLUMNS } from './portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from './portableWorkCatalog';
import { CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS } from './portableDocumentCatalog';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS } from './portableAssetCatalog';
import { CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS } from './portableOperationalCatalog';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS } from './portableWorkflowCatalog';
import { CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS } from './portableEngagementCatalog';
import { CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES } from './portableOperationalExport';
import { validateCoManagedPortableWorkspaceRecords, type CoManagedPortableRecordSections } from './portableWorkspaceGraph';
import { remapCoManagedPortableIdentity, type PortableRestoreIdentityDomain } from './portableRestoreIdentity';

export const CO_MANAGED_PORTABLE_RESTORE_SECTIONS = {
  core: CO_MANAGED_PORTABLE_CORE_COLUMNS, work: CO_MANAGED_PORTABLE_WORK_COLUMNS, documents: CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS,
  assets: CO_MANAGED_PORTABLE_ASSET_COLUMNS, operational: CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS,
  workflows: CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS, engagement: CO_MANAGED_PORTABLE_ENGAGEMENT_COLUMNS,
} as const;
export const CO_MANAGED_PORTABLE_RESTORE_GLOBALS = ['standard_statuses', 'shared_document_types', 'system_interaction_types', 'standard_service_types'] as const;
export type CoManagedPortableDestinationCatalogMappings = Record<typeof CO_MANAGED_PORTABLE_RESTORE_GLOBALS[number], Record<string, string>>;

// Explicit native identity roster. A new projected table must add its actual
// identity here; column naming/order cannot silently choose a restore domain.
const IDENTITIES: Record<string, readonly string[]> = {
  tenants: [],
  users: ["user_id"],
  teams: ["team_id"],
  team_members: ["team_id","user_id"],
  roles: ["role_id"],
  permissions: ["permission_id"],
  user_roles: ["user_id","role_id"],
  role_permissions: ["role_id","permission_id"],
  clients: ["client_id"],
  client_locations: ["location_id"],
  contacts: ["contact_name_id"],
  contact_phone_numbers: ["contact_phone_number_id"],
  contact_additional_email_addresses: ["contact_additional_email_address_id"],
  contact_email_type_definitions: ["contact_email_type_id"],
  contact_phone_type_definitions: ["contact_phone_type_id"],
  collaboration_actor_references: ["actor_reference_id"],
  boards: ["board_id"],
  statuses: ["status_id"],
  standard_statuses: ["standard_status_id"],
  priorities: ["priority_id"],
  severities: ["severity_id"],
  urgencies: ["urgency_id"],
  impacts: ["impact_id"],
  categories: ["category_id"],
  tickets: ["ticket_id"],
  ticket_resources: ["assignment_id"],
  comment_threads: ["thread_id"],
  comments: ["comment_id"],
  comment_reactions: ["reaction_id"],
  ticket_audit_logs: ["audit_id"],
  checklist_templates: ["template_id"],
  checklist_template_items: ["template_item_id"],
  checklist_template_apply_rules: ["apply_rule_id"],
  ticket_checklist_items: ["checklist_item_id"],
  projects: ["project_id"],
  project_phases: ["phase_id"],
  project_status_mappings: ["project_status_mapping_id"],
  project_tasks: ["task_id"],
  task_resources: ["assignment_id"],
  task_checklist_items: ["checklist_item_id"],
  project_task_dependencies: ["dependency_id"],
  project_ticket_links: ["link_id"],
  project_task_comments: ["task_comment_id"],
  project_task_comment_reactions: ["reaction_id"],
  handoff_history: ["operation_id"],
  documents: ["document_id"],
  document_versions: ["version_id"],
  document_content: ["id"],
  document_block_content: ["content_id"],
  document_associations: ["association_id"],
  document_folders: ["folder_id"],
  document_types: ["type_id"],
  shared_document_types: ["type_id"],
  document_default_folders: ["default_folder_id"],
  document_templates: ["template_id"],
  document_template_assignments: ["assignment_id"],
  kb_articles: ["article_id"],
  kb_article_relations: ["relation_id"],
  kb_article_reviewers: ["reviewer_id"],
  kb_article_templates: ["template_id"],
  assets: ["asset_id"],
  asset_type_registry: ["type_id"],
  workstation_assets: ["asset_id"],
  server_assets: ["asset_id"],
  network_device_assets: ["asset_id"],
  printer_assets: ["asset_id"],
  mobile_device_assets: ["asset_id"],
  software_catalog: ["software_id"],
  asset_software: ["asset_id","software_id"],
  asset_history: ["history_id"],
  asset_facts: ["asset_fact_id"],
  asset_relationships: ["parent_asset_id","child_asset_id"],
  asset_service_history: ["history_id"],
  asset_maintenance_schedules: ["schedule_id"],
  asset_maintenance_history: ["history_id"],
  asset_maintenance_occurrences: ["occurrence_id"],
  asset_document_associations: ["association_id"],
  asset_ticket_associations: ["association_id"],
  asset_associations: ["asset_id","entity_id","entity_type"],
  time_entries: ["entry_id"],
  time_sheets: ["id"],
  time_sheet_comments: ["comment_id"],
  time_entry_change_requests: ["change_request_id"],
  time_periods: ["period_id"],
  time_period_settings: ["time_period_settings_id"],
  time_period_types: ["type_id"],
  schedule_entries: ["entry_id"],
  schedule_entry_assignees: ["entry_id","user_id"],
  user_work_schedules: ["user_id","day_of_week"],
  business_hours_schedules: ["schedule_id"],
  business_hours_entries: ["entry_id"],
  holidays: ["holiday_id"],
  sla_policies: ["sla_policy_id"],
  sla_policy_targets: ["target_id"],
  sla_settings: [],
  sla_notification_thresholds: ["threshold_id"],
  workflow_definitions: ["workflow_id"],
  workflow_definition_versions: ["version_id"],
  workflow_form_definitions: ["form_id"],
  workflow_form_schemas: ["schema_id"],
  workflow_task_definitions: ["task_definition_id"],
  interactions: ["interaction_id"],
  interaction_types: ["type_id"],
  system_interaction_types: ["type_id"],
  appointment_requests: ["appointment_request_id"],
  availability_settings: ["availability_setting_id"],
  availability_exceptions: ["exception_id"],
  online_meetings: ["meeting_id"],
  online_meeting_artifacts: ["artifact_id"],
  service_catalog: ["service_id"],
  service_types: ["id"],
  standard_service_types: ["id"],
  service_categories: ["category_id"],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TARGETS: Record<string, readonly [string, string]> = {
  user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'], contact: ['contacts', 'contact_name_id'],
  ticket: ['tickets', 'ticket_id'], project: ['projects', 'project_id'], project_task: ['project_tasks', 'task_id'],
  asset: ['assets', 'asset_id'], document: ['documents', 'document_id'],
};
const INSERTION_DEFAULTS = Object.freeze({ time_entries: Object.freeze({ billing_mode: 'operational', billable_duration: 0, service_id: null, invoiced: false }) });

/** Trusted v1 restore adapter, not a database import or an authorization gate.
 * Destination catalog mappings must come from matching native global definitions
 * by semantic key; archive-supplied mappings must never reach this function. */
export function prepareCoManagedPortableWorkspaceRecords(input: {
  sourceTenant: string;
  destinationTenant: string;
  sections: unknown;
  destinationCatalogMappings: CoManagedPortableDestinationCatalogMappings;
}, options: { allocateUuid?: () => string } = {}) {
  const request = structuredClone(input);
  const source = validateCoManagedPortableWorkspaceRecords(request.sections, { sourceTenant: request.sourceTenant });
  const catalogMappings = request.destinationCatalogMappings;
  if (!catalogMappings || Object.keys(catalogMappings).length !== CO_MANAGED_PORTABLE_RESTORE_GLOBALS.length ||
      CO_MANAGED_PORTABLE_RESTORE_GLOBALS.some(table => !Object.hasOwn(catalogMappings, table))) throw new Error('Complete destination global catalog mappings are required');
  const columns = Object.assign({}, ...Object.values(CO_MANAGED_PORTABLE_RESTORE_SECTIONS));
  if (Object.keys(columns).length !== Object.keys(IDENTITIES).length || Object.keys(columns).some(table => !Object.hasOwn(IDENTITIES, table))) throw new Error('Portable restore identity roster is incomplete');
  const scalarSources = new Set(source.references.map(([table, column]) => JSON.stringify([table, column])));
  const valueTypes = { ...source.referenceValueTypes,
    user_work_schedules: { day_of_week: 'integer' as const }, asset_associations: { entity_type: 'text' as const } };
  const domains: PortableRestoreIdentityDomain[] = [];
  for (const [table, identities] of Object.entries(IDENTITIES)) for (const column of identities) {
    if (scalarSources.has(JSON.stringify([table, column]))) continue; // Extension and composite PK/FK aliases use the referenced root.
    const global = (CO_MANAGED_PORTABLE_RESTORE_GLOBALS as readonly string[]).includes(table);
    const preserve = table === 'workflow_form_definitions' || table === 'workflow_form_schemas' || table === 'user_work_schedules' || table === 'asset_associations';
    domains.push({ table, column, strategy: global ? 'provided' : preserve ? 'preserve' : 'allocate',
      ...(global ? { destinationBySource: catalogMappings[table as keyof typeof catalogMappings] } : {}) });
  }
  const transformed = remapCoManagedPortableIdentity(source.records, { columns, identities: IDENTITIES, valueTypes,
    references: source.references, counts: { tenants: { min: 1, max: 1 }, sla_settings: { max: 1 } }, identityDomains: domains,
    qualifiedActors: [
      { table: 'collaboration_actor_references', tenantColumn: 'actor_tenant', userColumn: 'actor_user_id', localUsers: ['users', 'user_id'] },
      { table: 'handoff_history', tenantColumn: 'actor_tenant', userColumn: 'actor_user_id', localUsers: ['users', 'user_id'] },
    ],
  }, { sourceTenant: request.sourceTenant, destinationTenant: request.destinationTenant, allocateUuid: options.allocateUuid });
  const records = transformed.records;
  const indexes = new Map<string, { valueType: string; values: Map<string, string | number> }>();
  for (const domain of transformed.domains) indexes.set(JSON.stringify([domain.table, domain.column]), {
    valueType: domain.valueType, values: new Map(domain.mappings.map(row => [String(row.source), row.destination])),
  });
  const mapped = (value: unknown, table: string, column: string): string | number => {
    const index = indexes.get(JSON.stringify([table, column]));
    const key = index?.valueType === 'uuid' ? String(value).toLowerCase() : String(value);
    const destination = index?.values.get(key);
    if (destination === undefined) throw new Error('Portable conditional restore mapping is missing');
    return destination;
  };
  for (const table of ['asset_associations', 'document_associations', 'document_folders']) for (const row of records[table]) {
    if (table === 'document_folders' && row.entity_id === null && row.entity_type === null) continue;
    if (row.entity_type === 'tenant') { row.entity_id = transformed.destinationTenant; continue; }
    const target = ENTITY_TARGETS[String(row.entity_type)];
    if (!target) throw new Error('Portable association requires an unsupported record section');
    row.entity_id = mapped(row.entity_id, ...target);
  }
  for (const source of CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES) for (const row of records[source.table]) {
    const target = (source.targets as Record<string, readonly [string, string] | null>)[String(row[source.discriminator])];
    if (target) row[source.column] = mapped(row[source.column], ...target);
  }
  for (const row of records.comment_threads) row.root_comment_id = row.ticket_id !== null
    ? mapped(row.root_comment_id, 'comments', 'comment_id') : mapped(row.root_comment_id, 'project_task_comments', 'task_comment_id');
  const localTypes = new Set(source.records.interaction_types.map(row => String(row.type_id).toLowerCase()));
  const systemTypes = new Set(source.records.system_interaction_types.map(row => String(row.type_id).toLowerCase()));
  for (const row of records.interactions) {
    const id = String(row.type_id).toLowerCase();
    if (localTypes.has(id) === systemTypes.has(id)) throw new Error('Portable interaction type identity is ambiguous');
    row.type_id = mapped(row.type_id, localTypes.has(id) ? 'interaction_types' : 'system_interaction_types', 'type_id');
  }
  for (const row of records.document_template_assignments) if (row.scope_type === 'client') row.scope_id = mapped(row.scope_id, 'clients', 'client_id');
  for (const row of records.workflow_task_definitions) if (row.form_type === 'tenant' && row.form_id !== null) row.form_id = mapped(row.form_id, 'workflow_form_definitions', 'form_id');
  for (const row of records.workflow_form_definitions) if (typeof row.created_by === 'string' && uuid.test(row.created_by)) row.created_by = mapped(row.created_by, 'users', 'user_id');
  for (const row of records.availability_settings) {
    const config = row.config_json as Record<string, unknown> | null;
    if (!config) continue;
    for (const [field, table, column] of [['approver_user_ids', 'users', 'user_id'], ['approver_team_ids', 'teams', 'team_id']] as const) {
      if (Array.isArray(config[field])) config[field] = (config[field] as string[]).map(id => mapped(id, table, column));
    }
    if (config.default_approver_id != null) config.default_approver_id = mapped(config.default_approver_id, 'users', 'user_id');
    if ('auto_approval_enabled' in config) config.auto_approval_enabled = false;
  }
  // Dispatch is never revived by importing an operational record. The later
  // database coordinator must also retain destination suspension until review.
  for (const row of records.users) row.is_inactive = true;
  for (const row of records.workflow_definitions) row.is_paused = true;
  for (const row of records.asset_maintenance_schedules) row.is_active = false;
  for (const row of records.comments) if (row.publish_state === 'scheduled') row.publish_state = 'canceled';
  for (const row of records.online_meetings) if (['scheduled', 'ended', 'recording_pending', 'cancel_pending'].includes(String(row.status))) row.status = 'cancelled';
  const sections = Object.fromEntries(Object.entries(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).map(([section, sectionColumns]) => [section,
    Object.fromEntries(Object.keys(sectionColumns).map(table => [table, records[table]]))])) as CoManagedPortableRecordSections;
  validateCoManagedPortableWorkspaceRecords(sections, { sourceTenant: transformed.destinationTenant });
  // The temporary asset association PK domains only held original discriminator
  // values until their explicit row-target rewrite. They are not reusable maps.
  const reusableDomains = transformed.domains.filter(domain => domain.table !== 'asset_associations');
  return { sourceTenant: transformed.sourceTenant, destinationTenant: transformed.destinationTenant, sections, records,
    domains: reusableDomains, insertionDefaults: INSERTION_DEFAULTS, globalCatalogTables: CO_MANAGED_PORTABLE_RESTORE_GLOBALS,
    restorePolicy: { authentication: 'reauthorize', sponsorship: 'none', externalConnections: 'reauthorize',
      destinationActivation: 'manual', workflowActivation: 'manual', notificationDispatch: 'paused', globalDefinitions: 'existing_destination_only',
      blobBindings: 'required', authoredReferences: 'review_required' } as const };
}
