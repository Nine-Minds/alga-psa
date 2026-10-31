import { CO_MANAGED_PORTABLE_CORE_COLUMNS } from './portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_COLUMNS } from './portableWorkCatalog';
import { CO_MANAGED_PORTABLE_ASSET_COLUMNS } from './portableAssetCatalog';
import { CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS } from './portableWorkflowCatalog';
import { validatePortableRecordSection, validatePortableRecordReferences,
  type PortableRecordReference, type PortableRecords } from './portableRecordValidation';
import type { CoManagedPortableWorkspaceManifest } from './portableWorkspaceManifest';
import { preparePortableWorkflowAuditHistory } from './portableWorkflowHistory';
import { remapCoManagedPortableIdentity, type PortableRestoreIdentityDomain, type PortableRestoreQualifiedActor,
  type PortableRestoreIdentityMap } from './portableRestoreIdentity';

type Row = Record<string, any>;
type IdentityType = 'uuid' | 'text' | 'integer';

/** A global catalog table: destination rows are matched by `fields` (semantic key), never by source UUID. */
export interface PortableRestoreGlobalCatalog { id: string; fields: readonly string[] }

export interface PortableRestoreProfileContext {
  records: PortableRecords; sourceTenant: string; destinationTenant: string;
  /** Destination value of a source identity, resolved through the remap domains. Throws if absent. */
  mapped(value: unknown, table: string, column: string): string | number;
}

/**
 * Restore-side declaration for one export contributor. The engine names no domain:
 * a contributor joins restore by registering a profile with its id (L7b3 adds its own).
 * Profiles are trusted local code; nothing in an archive can add, change or widen one.
 */
export interface PortableRestoreProfile {
  id: string;
  /** Native identity (primary key sans tenant) of every table the contributor owns. */
  identities: Readonly<Record<string, readonly string[]>>;
  /** Tables whose identity columns keep source values (natural keys). */
  preserve?: readonly string[];
  valueTypes?: Readonly<Record<string, Readonly<Record<string, IdentityType>>>>;
  globals?: Readonly<Record<string, PortableRestoreGlobalCatalog>>;
  qualifiedActors?: readonly PortableRestoreQualifiedActor[];
  /** A column whose meaning depends on a discriminator column (`kind -> [table, column]`). */
  polymorphic?: readonly { table: string; column: string; discriminator: string; targets: Readonly<Record<string, readonly [string, string]>> }[];
  /** A column that is an identity reference only for some rows. */
  conditional?: readonly ({ table: string; column: string; parent: string; parentColumn: string } &
    ({ discriminator: string; equals: string } | { uuidOnly: true }))[];
  /** Policy transforms: imported dispatch/automation is never live in the destination. */
  apply?(context: PortableRestoreProfileContext): void;
  /**
   * Tables with no native destination form (historical evidence, not live records). They are not inserted;
   * `project` turns them into rows of a native table (for example audit logs) so nothing is silently lost.
   */
  historical?: readonly string[];
  project?(prepared: PreparedPortableWorkspaceRecords): Record<string, Row[]>;
}

// ---- Shipped profiles (L7b1 contributors) -------------------------------------------------------

const coreProfile: PortableRestoreProfile = {
  id: 'core',
  identities: { tenants: [], users: ['user_id'], teams: ['team_id'], team_members: ['team_id', 'user_id'], roles: ['role_id'],
    permissions: ['permission_id'], user_roles: ['user_id', 'role_id'], role_permissions: ['role_id', 'permission_id'],
    clients: ['client_id'], client_locations: ['location_id'], contacts: ['contact_name_id'],
    contact_phone_numbers: ['contact_phone_number_id'], contact_additional_email_addresses: ['contact_additional_email_address_id'],
    contact_email_type_definitions: ['contact_email_type_id'], contact_phone_type_definitions: ['contact_phone_type_id'],
    collaboration_actor_references: ['actor_reference_id'] },
  qualifiedActors: [{ table: 'collaboration_actor_references', tenantColumn: 'actor_tenant', userColumn: 'actor_user_id', localUsers: ['users', 'user_id'] }],
  apply: ({ records }) => { for (const row of records.users) row.is_inactive = true; },
};
const workProfile: PortableRestoreProfile = {
  id: 'work',
  // Cross-tenant handoff history is historical evidence; it is kept as ticket activity, never as a live relationship.
  historical: ['handoff_history'],
  project: prepared => ({ ticket_audit_logs: prepared.records.handoff_history.map(row => {
    const local = prepared.records.users.some(user => String(user.user_id).toLowerCase() === String(row.actor_user_id).toLowerCase()) &&
      String(row.actor_tenant).toLowerCase() === prepared.destinationTenant;
    const reference = prepared.records.collaboration_actor_references.find(actor => String(actor.actor_tenant).toLowerCase() === String(row.actor_tenant).toLowerCase() &&
      String(actor.actor_user_id).toLowerCase() === String(row.actor_user_id).toLowerCase());
    return { audit_id: row.operation_id, ticket_id: row.ticket_id, event_type: 'TICKET_HANDOFF_RESTORED', entity_type: 'ticket', entity_id: row.ticket_id,
      actor_type: 'user', actor_user_id: local ? row.actor_user_id : null, actor_contact_id: null, actor_reference_id: local ? null : reference?.actor_reference_id ?? null,
      actor_display_name: row.actor_name, actor_organization_name: row.actor_organization, source: 'system', occurred_at: row.occurred_at,
      created_at: row.occurred_at, changes: {}, details: { portable_handoff: { ...row }, is_internal: row.audience !== 'requester', collaboration_audience: row.audience } };
  }) }),
  identities: { boards: ['board_id'], statuses: ['status_id'], standard_statuses: ['standard_status_id'], priorities: ['priority_id'],
    severities: ['severity_id'], urgencies: ['urgency_id'], impacts: ['impact_id'], categories: ['category_id'], tickets: ['ticket_id'],
    ticket_resources: ['assignment_id'], comment_threads: ['thread_id'], comments: ['comment_id'], comment_reactions: ['reaction_id'],
    ticket_audit_logs: ['audit_id'], checklist_templates: ['template_id'], checklist_template_items: ['template_item_id'],
    checklist_template_apply_rules: ['apply_rule_id'], ticket_checklist_items: ['checklist_item_id'], projects: ['project_id'],
    project_phases: ['phase_id'], project_status_mappings: ['project_status_mapping_id'], project_tasks: ['task_id'],
    task_resources: ['assignment_id'], task_checklist_items: ['checklist_item_id'], project_task_dependencies: ['dependency_id'],
    project_ticket_links: ['link_id'], project_task_comments: ['task_comment_id'], project_task_comment_reactions: ['reaction_id'],
    handoff_history: ['operation_id'] },
  globals: { standard_statuses: { id: 'standard_status_id', fields: ['name', 'item_type', 'is_closed', 'is_default'] } },
  qualifiedActors: [{ table: 'handoff_history', tenantColumn: 'actor_tenant', userColumn: 'actor_user_id', localUsers: ['users', 'user_id'] }],
  apply: ({ records, mapped }) => {
    // A thread's root is a ticket comment or a task comment; the export does not model that as an edge.
    for (const row of records.comment_threads) row.root_comment_id = row.ticket_id !== null
      ? mapped(row.root_comment_id, 'comments', 'comment_id') : mapped(row.root_comment_id, 'project_task_comments', 'task_comment_id');
    for (const row of records.comments) if (row.publish_state === 'scheduled') row.publish_state = 'canceled';
  },
};
const ENTITY_TARGETS = { user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'], contact: ['contacts', 'contact_name_id'],
  ticket: ['tickets', 'ticket_id'], project: ['projects', 'project_id'], asset: ['assets', 'asset_id'], document: ['documents', 'document_id'] } as const;
const assetProfile: PortableRestoreProfile = {
  id: 'assets',
  identities: { assets: ['asset_id'], asset_type_registry: ['type_id'], workstation_assets: ['asset_id'], server_assets: ['asset_id'],
    network_device_assets: ['asset_id'], printer_assets: ['asset_id'], mobile_device_assets: ['asset_id'], software_catalog: ['software_id'],
    asset_software: ['asset_id', 'software_id'], asset_history: ['history_id'], asset_facts: ['asset_fact_id'],
    asset_relationships: ['parent_asset_id', 'child_asset_id'], asset_service_history: ['history_id'],
    asset_maintenance_schedules: ['schedule_id'], asset_maintenance_history: ['history_id'], asset_maintenance_occurrences: ['occurrence_id'],
    asset_document_associations: ['association_id'], asset_ticket_associations: ['association_id'],
    asset_associations: ['asset_id', 'entity_id', 'entity_type'] },
  preserve: ['asset_associations'],
  valueTypes: { asset_associations: { entity_type: 'text' } },
  polymorphic: [{ table: 'asset_associations', column: 'entity_id', discriminator: 'entity_type', targets: ENTITY_TARGETS }],
  apply: ({ records }) => { for (const row of records.asset_maintenance_schedules) row.is_active = false; },
};
const workflowProfile: PortableRestoreProfile = {
  id: 'workflows',
  // Task responses are business history, never executable task-inbox rows.
  historical: ['workflow_tasks', 'workflow_task_history'],
  project: prepared => ({ audit_logs: preparePortableWorkflowAuditHistory(prepared) }),
  identities: { workflow_definitions: ['workflow_id'], workflow_definition_versions: ['version_id'], workflow_form_definitions: ['form_id'],
    workflow_form_schemas: ['schema_id'], workflow_task_definitions: ['task_definition_id'], workflow_tasks: ['task_id'],
    workflow_task_history: ['history_id'] },
  preserve: ['workflow_form_definitions', 'workflow_form_schemas'],
  valueTypes: { workflow_form_definitions: { form_id: 'text' }, workflow_form_schemas: { schema_id: 'text', form_id: 'text' } },
  conditional: [
    { table: 'workflow_task_definitions', column: 'form_id', parent: 'workflow_form_definitions', parentColumn: 'form_id', discriminator: 'form_type', equals: 'tenant' },
    { table: 'workflow_form_definitions', column: 'created_by', parent: 'users', parentColumn: 'user_id', uuidOnly: true },
  ],
  apply: ({ records }) => { for (const row of records.workflow_definitions) row.is_paused = true; },
};
// LEVERAGE: pattern portable-contributor-boilerplate — restore profiles re-declare identities/polymorphic edges the export contributors already know; one declaration per domain would serve both halves.
export const CORE_PORTABLE_RESTORE_PROFILES: readonly PortableRestoreProfile[] = Object.freeze([coreProfile, workProfile, assetProfile, workflowProfile]);

/** Columns the shipped contributors project, kept for tests that compare against the live registry. */
export const CO_MANAGED_PORTABLE_RESTORE_SECTIONS = {
  core: CO_MANAGED_PORTABLE_CORE_COLUMNS, work: CO_MANAGED_PORTABLE_WORK_COLUMNS,
  assets: CO_MANAGED_PORTABLE_ASSET_COLUMNS, workflows: CO_MANAGED_PORTABLE_WORKFLOW_COLUMNS,
} as const;

export type PortableDestinationCatalogMappings = Record<string, Record<string, string>>;
export type CoManagedPortableDestinationCatalogMappings = PortableDestinationCatalogMappings;

export interface PortableExternalReferenceReport {
  /** `table.column` -> rows whose external reference was cleared (the column is nullable). */
  nulled: Record<string, number>;
  /** table -> rows removed because they exist only to point at a domain this archive does not carry. */
  dropped: Record<string, number>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): never => { throw new Error(`Portable restore rejected: ${message}`); };

function profilesFor(manifest: CoManagedPortableWorkspaceManifest, registry: readonly PortableRestoreProfile[]) {
  const byId = new Map(registry.map(profile => [profile.id, profile]));
  return manifest.sections.map(section => {
    const profile = byId.get(section.id) ?? fail(`no restore profile for contributor "${section.id}"`);
    const tables = Object.keys(section.columns);
    // Fail closed: a projected table without a declared identity can never be silently restored.
    if (tables.some(table => !Object.hasOwn(profile.identities, table)) || Object.keys(profile.identities).some(table => !tables.includes(table))) {
      fail(`restore profile "${section.id}" does not match the archive's tables`);
    }
    return { profile, section };
  });
}

/** Global catalog specs of every profile in this archive: the DB layer resolves each against the destination. */
export function portableRestoreGlobalCatalogs(manifest: CoManagedPortableWorkspaceManifest,
  registry: readonly PortableRestoreProfile[] = CORE_PORTABLE_RESTORE_PROFILES): Record<string, PortableRestoreGlobalCatalog> {
  return Object.assign({}, ...profilesFor(manifest, registry).map(({ profile }) => profile.globals ?? {}));
}

/**
 * Trusted restore transformation over an authenticated, registry-pinned manifest.
 * It is not a database import or an authorization gate. Destination catalog
 * mappings must come from matching native global definitions by semantic key;
 * archive-supplied mappings must never reach this function.
 */
export function prepareCoManagedPortableWorkspaceRecords(input: {
  manifest: CoManagedPortableWorkspaceManifest;
  destinationTenant: string;
  destinationCatalogMappings: PortableDestinationCatalogMappings;
  /** Whether a destination column accepts NULL; decides how external references are reconciled. */
  externalColumnNullable?: (table: string, column: string) => boolean;
  profiles?: readonly PortableRestoreProfile[];
}, options: { allocateUuid?: () => string } = {}) {
  const manifest = structuredClone(input.manifest), sourceTenant = manifest.context.sourceTenant;
  const destinationTenant = input.destinationTenant;
  const resolved = profilesFor(manifest, input.profiles ?? CORE_PORTABLE_RESTORE_PROFILES);
  const catalogMappings = input.destinationCatalogMappings;
  const globals = Object.assign({}, ...resolved.map(({ profile }) => profile.globals ?? {})) as Record<string, PortableRestoreGlobalCatalog>;
  if (!catalogMappings || Object.keys(catalogMappings).length !== Object.keys(globals).length ||
      Object.keys(globals).some(table => !Object.hasOwn(catalogMappings, table))) fail('complete destination global catalog mappings are required');

  const columns: Record<string, readonly string[]> = Object.assign({}, ...resolved.map(({ section }) => section.columns));
  const identities: Record<string, readonly string[]> = Object.assign({}, ...resolved.map(({ profile }) => profile.identities));
  const valueTypes: Record<string, Record<string, IdentityType>> = {};
  for (const { profile } of resolved) for (const [table, types] of Object.entries(profile.valueTypes ?? {})) valueTypes[table] = { ...valueTypes[table], ...types };
  const records: PortableRecords = structuredClone(Object.assign({}, ...resolved.map(({ section }) => section.records)));
  const sourceRecords = structuredClone(records);
  const edges = manifest.references;
  const references: PortableRecordReference[] = edges.filter(edge => edge.status === 'resolved')
    .map(edge => [edge.table, edge.column, edge.parent, edge.parentColumn] as const);

  // 1. External references (a domain no contributor in this archive provides) are reconciled before
  //    identity remapping: cleared when the destination column is nullable, otherwise the row that
  //    exists only to carry the reference is dropped. A dependent row then fails reference validation.
  const report: PortableExternalReferenceReport = { nulled: {}, dropped: {} };
  const nullable = input.externalColumnNullable ?? (() => false);
  const dropped = new Map<string, Set<Row>>();
  for (const edge of edges.filter(edge => edge.status === 'external')) {
    for (const row of records[edge.table]) {
      if (row[edge.column] === null || row[edge.column] === undefined) continue;
      if (nullable(edge.table, edge.column)) { row[edge.column] = null; report.nulled[`${edge.table}.${edge.column}`] = (report.nulled[`${edge.table}.${edge.column}`] ?? 0) + 1; }
      else { if (!dropped.has(edge.table)) dropped.set(edge.table, new Set()); dropped.get(edge.table)!.add(row); }
    }
  }
  // 2. Polymorphic rows pointing at a table this archive does not carry are the same case.
  const polymorphic = resolved.flatMap(({ profile }) => profile.polymorphic ?? []);
  for (const rule of polymorphic) for (const row of records[rule.table]) {
    const target = rule.targets[String(row[rule.discriminator])];
    if (!target) fail('association requires an unsupported record kind');
    if (!Object.hasOwn(records, target[0])) { if (!dropped.has(rule.table)) dropped.set(rule.table, new Set()); dropped.get(rule.table)!.add(row); }
  }
  for (const [table, rows] of dropped) {
    records[table] = records[table].filter(row => !rows.has(row)); report.dropped[table] = rows.size;
  }

  // 3. Identity remap over the resolved graph.
  const scalarSources = new Set(references.map(([table, column]) => JSON.stringify([table, column])));
  const preserved = new Set(resolved.flatMap(({ profile }) => profile.preserve ?? []));
  const domains: PortableRestoreIdentityDomain[] = [];
  for (const [table, ids] of Object.entries(identities)) for (const column of ids) {
    if (scalarSources.has(JSON.stringify([table, column]))) continue; // Composite PK/FK aliases follow the referenced root.
    const global = Object.hasOwn(globals, table);
    domains.push({ table, column, strategy: global ? 'provided' : preserved.has(table) ? 'preserve' : 'allocate',
      ...(global ? { destinationBySource: catalogMappings[table] } : {}) });
  }
  const transformed = remapCoManagedPortableIdentity(records, { columns, identities, valueTypes, references,
    counts: { tenants: { min: 1, max: 1 } }, identityDomains: domains,
    qualifiedActors: resolved.flatMap(({ profile }) => profile.qualifiedActors ?? []) },
  { sourceTenant, destinationTenant, allocateUuid: options.allocateUuid });
  const remapped = transformed.records;
  const indexes = new Map<string, { valueType: string; values: Map<string, string | number> }>();
  for (const domain of transformed.domains) indexes.set(JSON.stringify([domain.table, domain.column]), {
    valueType: domain.valueType, values: new Map(domain.mappings.map(row => [String(row.source), row.destination])) });
  const mapped = (value: unknown, table: string, column: string): string | number => {
    const index = indexes.get(JSON.stringify([table, column]));
    const destination = index?.values.get(index.valueType === 'uuid' ? String(value).toLowerCase() : String(value));
    return destination ?? fail('conditional restore mapping is missing');
  };

  // 4. Declared polymorphic and conditional references, then each profile's policy transforms.
  for (const rule of polymorphic) for (const row of remapped[rule.table]) row[rule.column] = mapped(row[rule.column], ...rule.targets[String(row[rule.discriminator])]);
  for (const rule of resolved.flatMap(({ profile }) => profile.conditional ?? [])) for (const row of remapped[rule.table]) {
    if ('equals' in rule ? row[rule.discriminator] !== rule.equals || row[rule.column] === null : typeof row[rule.column] !== 'string' || !uuid.test(row[rule.column] as string)) continue;
    row[rule.column] = mapped(row[rule.column], rule.parent, rule.parentColumn);
  }
  for (const { profile } of resolved) profile.apply?.({ records: remapped, sourceTenant, destinationTenant: transformed.destinationTenant, mapped });

  // 5. Every section must still satisfy its own contract under the destination identities.
  const sections: Record<string, PortableRecords> = {};
  for (const { profile, section } of resolved) {
    const own = Object.fromEntries(Object.keys(section.columns).map(table => [table, remapped[table]]));
    sections[section.id] = own;
    validatePortableRecordSection(own, { columns: section.columns, identities: profile.identities, valueTypes: profile.valueTypes,
      references: references.filter(([table]) => Object.hasOwn(section.columns, table) && Object.hasOwn(own, table)).filter(([, , parent]) => Object.hasOwn(own, parent)) });
  }
  validatePortableRecordReferences(remapped, references, valueTypes, true);
  // Anything not rewritten stays an inert historical pair; nothing may still carry the source tenant as a destination value.
  const reusable: PortableRestoreIdentityMap[] = transformed.domains.filter(domain => !polymorphic.some(rule => rule.table === domain.table));
  return { sourceTenant: transformed.sourceTenant, destinationTenant: transformed.destinationTenant, packageId: manifest.context.packageId,
    sections, records: remapped, sourceRecords, tables: Object.keys(columns).sort(), columns, domains: reusable, externalReferences: report,
    globalCatalogs: globals, profiles: resolved.map(({ profile }) => profile),
    restorePolicy: { authentication: 'reauthorize', sponsorship: 'none', externalConnections: 'reauthorize', destinationActivation: 'manual',
      workflowActivation: 'manual', notificationDispatch: 'paused', globalDefinitions: 'existing_destination_only',
      blobBindings: 'required', authoredReferences: 'review_required' } as const };
}
export type PreparedPortableWorkspaceRecords = ReturnType<typeof prepareCoManagedPortableWorkspaceRecords>;
