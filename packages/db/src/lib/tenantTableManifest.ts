/**
 * Tenant table manifest and FK ordering engine.
 *
 * One declarative entry per tenant table. Deletion, export, scope and client-merge
 * facts hang off that entry instead of each lifecycle consumer keeping a private
 * list. Declaration order is the authoring rank: it is the deletion order, and
 * `computeTenantDeletionOrder()` validates it against the restrictive foreign keys
 * (Kahn's algorithm, ties broken by rank) and computes legal placements for new
 * entries. The engine validates and places; it does not re-derive existing positions.
 *
 * Runtime consumers (`tenantDeletionOrder()`, `tenantExportOrder()`) read the
 * declared entries and never run the engine, so a cycle can only surface from
 * tooling and tests (`generate-tenant-manifest.ts --check`, the golden test).
 *
 * `tenantTableMetadata.ts` and `server/migrations/utils/tenantDb.cjs` stay literals
 * (source-text contract tests read them); the manifest is cross-checked against them.
 */
// LEVERAGE: pattern tenant-lifecycle-lists — deletion, export, Citus and migration metadata each hold a private table list

import type { TenantTableScope } from './tenantTableMetadata';
import { TENANT_TABLE_FOREIGN_KEYS, type TenantTableForeignKey } from './tenantTableForeignKeys';

export type { TenantTableForeignKey } from './tenantTableForeignKeys';

export interface TenantTableReference {
  /** The parent table the FK points at. */
  table: string;
  /** The referencing column on this table (tenant column excluded). */
  column: string;
  /** The live rule on the FK ('NONE' where the schema declares no constraint). Informational: the DAG reads the snapshot. */
  onDelete: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NONE';
  /**
   * `null-before-delete`: the deletion workflow NULLs this column before the loop
   * runs (`breakCircularDependencies()`), so the edge is not part of the DAG.
   */
  resolution: 'null-before-delete';
}

export interface TenantTableEntry {
  table: string;
  /** `ordered`: deleted by the loop in declared order. `excluded`: never deleted by it (reason required). */
  deletion: 'ordered' | 'excluded';
  /** Required when `deletion` is `excluded`. */
  reason?: string;
  /** Declared where `tenantTableMetadata` has no entry; the tenant column is discovered at runtime. */
  scope?: TenantTableScope;
  /** Position in the tenant export, ascending. */
  export?: { rank: number };
  citus?: 'distributed' | 'local' | 'unstated';
  /** Keyed on `client_id`; must be classified by the client merge plan. */
  clientKeyed?: boolean;
  references?: readonly TenantTableReference[];
  block?: string;
  note?: string;
}

export class TenantManifestCycleError extends Error {
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`Restrictive foreign keys form a cycle with no declared resolution: ${cycle.join(' -> ')}`);
    this.name = 'TenantManifestCycleError';
    this.cycle = cycle;
  }
}

export interface TenantDeletionViolation {
  child: string;
  parent: string;
  column: string;
  deleteRule: string;
  childIndex: number;
  parentIndex: number;
}

export interface TenantInsertionWindow {
  table: string;
  /** Tables that reference `table` restrictively: they must be deleted first. */
  mustFollow: string[];
  /** Tables `table` references restrictively: it must be deleted before them. */
  mustPrecede: string[];
  /** Smallest legal index in the computed order (after the last of `mustFollow`). */
  earliestIndex: number;
  /** Largest legal index (at or before the first of `mustPrecede`); `order.length` if unconstrained. */
  latestIndex: number;
  /** Table after which to insert (null: at the very start). */
  insertAfter: string | null;
}

export interface TenantDeletionComputation {
  /** Legal order: the declared order when it has no violations. */
  order: string[];
  violations: TenantDeletionViolation[];
  /** Legal windows for every table whose declared position is a violation. */
  insertions: TenantInsertionWindow[];
}

const RESTRICTIVE = new Set(['NO ACTION', 'RESTRICT']);

export function isRestrictive(rule: string): boolean {
  return RESTRICTIVE.has(rule);
}

function entries(manifest: readonly TenantTableEntry[]) {
  return manifest.filter(entry => entry.deletion === 'ordered');
}

/** The restrictive edges that constrain the DAG: both ends ordered, not self, not declared resolved. */
export function deletionEdges(
  manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST,
  foreignKeys: readonly TenantTableForeignKey[] = TENANT_TABLE_FOREIGN_KEYS,
): TenantTableForeignKey[] {
  const ordered = new Set(entries(manifest).map(entry => entry.table));
  const resolved = new Set<string>();
  for (const entry of manifest) {
    for (const ref of entry.references ?? []) {
      if (ref.resolution === 'null-before-delete') resolved.add(`${entry.table}|${ref.column}|${ref.table}`);
    }
  }
  return foreignKeys.filter(fk =>
    isRestrictive(fk.deleteRule)
    && fk.child !== fk.parent
    && ordered.has(fk.child)
    && ordered.has(fk.parent)
    && !resolved.has(`${fk.child}|${fk.column}|${fk.parent}`));
}

function findCycle(remaining: Set<string>, edges: readonly TenantTableForeignKey[]): string[] {
  const next = new Map<string, string[]>();
  for (const fk of edges) {
    if (remaining.has(fk.child) && remaining.has(fk.parent)) {
      (next.get(fk.child) ?? next.set(fk.child, []).get(fk.child)!).push(fk.parent);
    }
  }
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const to of next.get(node) ?? []) {
      if (state.get(to) === 1) return [...stack.slice(stack.indexOf(to)), to];
      if (!state.has(to)) {
        const found = visit(to);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of remaining) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return [...remaining];
}

/**
 * Kahn's algorithm over the restrictive FK edges (child before parent), ties broken
 * by declared rank. A declared order with no violations is returned unchanged.
 * Raises `TenantManifestCycleError` for a cycle with no `null-before-delete` declaration.
 * Tooling and tests only: nothing on the runtime path calls this.
 */
export function computeTenantDeletionOrder(
  manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST,
  foreignKeys: readonly TenantTableForeignKey[] = TENANT_TABLE_FOREIGN_KEYS,
): TenantDeletionComputation {
  const declared = entries(manifest).map(entry => entry.table);
  const rank = new Map(declared.map((table, index) => [table, index]));
  const edges = deletionEdges(manifest, foreignKeys);

  const indegree = new Map(declared.map(table => [table, 0]));
  const outgoing = new Map<string, string[]>();
  for (const fk of edges) {
    indegree.set(fk.parent, (indegree.get(fk.parent) ?? 0) + 1);
    (outgoing.get(fk.child) ?? outgoing.set(fk.child, []).get(fk.child)!).push(fk.parent);
  }

  const order: string[] = [];
  const ready = declared.filter(table => indegree.get(table) === 0);
  const done = new Set<string>();
  while (ready.length) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (rank.get(ready[i])! < rank.get(ready[best])!) best = i;
    const [table] = ready.splice(best, 1);
    order.push(table);
    done.add(table);
    for (const parent of outgoing.get(table) ?? []) {
      const left = (indegree.get(parent) ?? 0) - 1;
      indegree.set(parent, left);
      if (left === 0) ready.push(parent);
    }
  }
  if (order.length !== declared.length) {
    throw new TenantManifestCycleError(findCycle(new Set(declared.filter(table => !done.has(table))), edges));
  }

  const violations: TenantDeletionViolation[] = [];
  for (const fk of edges) {
    const childIndex = rank.get(fk.child)!;
    const parentIndex = rank.get(fk.parent)!;
    if (childIndex >= parentIndex) {
      violations.push({ child: fk.child, parent: fk.parent, column: fk.column, deleteRule: fk.deleteRule, childIndex, parentIndex });
    }
  }

  const insertions = [...new Set(violations.flatMap(v => [v.child, v.parent]))]
    .map(table => placeTenantTable(table, order, foreignKeys, manifest));
  return { order, violations, insertions };
}

/**
 * The legal insertion window for `table` in `order` (the computed order, without
 * `table` itself if it is already present). Works for a table that is not in the
 * manifest yet; it reads the FK snapshot, so regenerate the snapshot first.
 */
export function placeTenantTable(
  table: string,
  order: readonly string[],
  foreignKeys: readonly TenantTableForeignKey[] = TENANT_TABLE_FOREIGN_KEYS,
  manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST,
): TenantInsertionWindow {
  const without = order.filter(name => name !== table);
  const index = new Map(without.map((name, i) => [name, i]));
  const resolved = new Set<string>();
  for (const entry of manifest) {
    for (const ref of entry.references ?? []) {
      if (ref.resolution === 'null-before-delete') resolved.add(`${entry.table}|${ref.column}|${ref.table}`);
    }
  }
  const mustFollow = new Set<string>();
  const mustPrecede = new Set<string>();
  for (const fk of foreignKeys) {
    if (!isRestrictive(fk.deleteRule) || fk.child === fk.parent) continue;
    if (resolved.has(`${fk.child}|${fk.column}|${fk.parent}`)) continue;
    if (fk.parent === table && index.has(fk.child)) mustFollow.add(fk.child);
    if (fk.child === table && index.has(fk.parent)) mustPrecede.add(fk.parent);
  }
  const follow = [...mustFollow].sort((a, b) => index.get(a)! - index.get(b)!);
  const precede = [...mustPrecede].sort((a, b) => index.get(a)! - index.get(b)!);
  const earliestIndex = follow.length ? index.get(follow[follow.length - 1])! + 1 : 0;
  const latestIndex = precede.length ? index.get(precede[0])! : without.length;
  return {
    table,
    mustFollow: follow,
    mustPrecede: precede,
    earliestIndex,
    latestIndex,
    insertAfter: earliestIndex > 0 ? without[earliestIndex - 1] : null,
  };
}

/** The ordered set and loop sequence the deletion workflow runs: declared order, no I/O, no engine. */
export function tenantDeletionOrder(manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST): readonly string[] {
  if (manifest === TENANT_TABLE_MANIFEST) return (deletionOrderCache ??= Object.freeze(entries(manifest).map(entry => entry.table)));
  return entries(manifest).map(entry => entry.table);
}
let deletionOrderCache: readonly string[] | undefined;

/** Tables exported for a tenant data export, by declared rank. */
export function tenantExportOrder(manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST): readonly string[] {
  const build = () => manifest
    .filter(entry => entry.export)
    .sort((a, b) => a.export!.rank - b.export!.rank)
    .map(entry => entry.table);
  if (manifest === TENANT_TABLE_MANIFEST) return (exportOrderCache ??= Object.freeze(build()));
  return build();
}
let exportOrderCache: readonly string[] | undefined;

export function tenantClientKeyedTables(manifest: readonly TenantTableEntry[] = TENANT_TABLE_MANIFEST): readonly string[] {
  return manifest.filter(entry => entry.clientKeyed).map(entry => entry.table);
}

export function getTenantTableManifestEntry(table: string): TenantTableEntry | undefined {
  return (manifestIndex ??= new Map(TENANT_TABLE_MANIFEST.map(entry => [entry.table, entry]))).get(table);
}
let manifestIndex: Map<string, TenantTableEntry> | undefined;

/**
 * One entry per tenant table. For `deletion: 'ordered'` entries, declaration order is the
 * deletion order and must stay a legal topological order of the restrictive FKs
 * (`scripts/generate-tenant-manifest.ts --check`). Add new tables with
 * `--place <table>`; never edit a lifecycle list.
 */
export const TENANT_TABLE_MANIFEST: readonly TenantTableEntry[] = [
  { table: 'email_sender_routes', deletion: 'ordered' },
  { table: 'email_sender_addresses', deletion: 'ordered' },
  { table: 'rma_events', deletion: 'ordered' },
  { table: 'rma_cases', deletion: 'ordered', clientKeyed: true },
  { table: 'asset_custody_events', deletion: 'ordered' },
  { table: 'asset_custody', deletion: 'ordered', clientKeyed: true },
  { table: 'sessions', deletion: 'ordered' },
  { table: 'staging_container_members', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'staging_containers', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'stock_movements', deletion: 'ordered' },
  { table: 'stock_transfer_lines', deletion: 'ordered' },
  { table: 'kit_components', deletion: 'ordered' },
  { table: 'stock_levels', deletion: 'ordered' },
  { table: 'product_inventory_settings', deletion: 'ordered' },
  { table: 'count_lines', deletion: 'ordered' },
  { table: 'vendor_bill_lines', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'po_landed_costs', deletion: 'ordered' },
  { table: 'purchase_order_lines', deletion: 'ordered' },
  { table: 'sales_order_lines', deletion: 'ordered' },
  { table: 'document_template_assignments', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'vendor_products', deletion: 'ordered' },
  { table: 'ghost_usage_reviews', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'project_staging_lines', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'stock_units', deletion: 'ordered', clientKeyed: true, references: [{ table: 'project_staging_lines', column: 'allocated_staging_line_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
  { table: 'count_sessions', deletion: 'ordered' },
  { table: 'vendor_bills', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'sales_orders', deletion: 'ordered', clientKeyed: true },
  { table: 'stock_transfers', deletion: 'ordered' },
  { table: 'purchase_orders', deletion: 'ordered' },
  { table: 'document_templates', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'stock_locations', deletion: 'ordered' },
  { table: 'app_search_index', deletion: 'ordered' },
  { table: 'workflow_task_history', deletion: 'ordered' },
  { table: 'workflow_form_schemas', deletion: 'ordered' },
  { table: 'workflow_run_steps', deletion: 'ordered' },
  { table: 'workflow_run_waits', deletion: 'ordered' },
  { table: 'workflow_run_snapshots', deletion: 'ordered' },
  { table: 'workflow_action_invocations', deletion: 'ordered' },
  { table: 'workflow_definition_versions', deletion: 'ordered' },
  { table: 'workflow_run_logs', deletion: 'ordered' },
  { table: 'workflow_event_launch_skips', deletion: 'ordered' },
  { table: 'workflow_runtime_events', deletion: 'ordered' },
  { table: 'workflow_step_usage_periods', deletion: 'ordered' },
  { table: 'workflow_data_store', deletion: 'ordered' },
  { table: 'workflow_entity_links', deletion: 'ordered' },
  { table: 'date_trigger_emissions', deletion: 'ordered' },
  { table: 'workflow_runs', deletion: 'ordered' },
  { table: 'tenant_workflow_schedule', deletion: 'ordered' },
  { table: 'workflow_definitions', deletion: 'ordered' },
  { table: 'marketing_sequence_sends', deletion: 'ordered' },
  { table: 'marketing_engagements', deletion: 'ordered' },
  { table: 'social_post_targets', deletion: 'ordered' },
  { table: 'social_posts', deletion: 'ordered' },
  { table: 'marketing_sequence_enrollments', deletion: 'ordered' },
  { table: 'marketing_sequence_steps', deletion: 'ordered' },
  { table: 'marketing_sequences', deletion: 'ordered' },
  { table: 'marketing_capture_forms', deletion: 'ordered' },
  { table: 'marketing_content', deletion: 'ordered' },
  { table: 'marketing_contact_state', deletion: 'ordered' },
  { table: 'marketing_suppressions', deletion: 'ordered' },
  { table: 'marketing_channels', deletion: 'ordered' },
  { table: 'marketing_campaigns', deletion: 'ordered' },
  { table: 'interactions', deletion: 'ordered', export: { rank: 42 }, clientKeyed: true },
  { table: 'interaction_types', deletion: 'ordered' },
  { table: 'task_checklist_items', deletion: 'ordered' },
  { table: 'project_task_dependencies', deletion: 'ordered' },
  { table: 'task_resources', deletion: 'ordered' },
  { table: 'project_ticket_links', deletion: 'ordered' },
  { table: 'project_task_comment_reactions', deletion: 'ordered' },
  { table: 'project_task_comments', deletion: 'ordered', export: { rank: 14 } },
  { table: 'project_materials', deletion: 'ordered', export: { rank: 15 }, clientKeyed: true },
  { table: 'ticket_materials', deletion: 'ordered', export: { rank: 6 }, clientKeyed: true },
  { table: 'project_template_checklist_items', deletion: 'ordered' },
  { table: 'project_template_dependencies', deletion: 'ordered' },
  { table: 'project_template_task_resources', deletion: 'ordered' },
  { table: 'project_template_status_mappings', deletion: 'ordered' },
  { table: 'project_template_tasks', deletion: 'ordered' },
  { table: 'project_template_phases', deletion: 'ordered' },
  { table: 'project_templates', deletion: 'ordered' },
  { table: 'quote_activities', deletion: 'ordered' },
  { table: 'quote_items', deletion: 'ordered' },
  { table: 'quote_document_template_assignments', deletion: 'ordered' },
  { table: 'quote_document_templates', deletion: 'ordered' },
  { table: 'standard_quote_document_templates', deletion: 'ordered' },
  { table: 'quotes', deletion: 'ordered', clientKeyed: true },
  { table: 'opportunity_meeting_reviews', deletion: 'ordered' },
  { table: 'opportunity_commitments', deletion: 'ordered' },
  { table: 'opportunity_steps', deletion: 'ordered' },
  { table: 'opportunity_step_templates', deletion: 'ordered' },
  { table: 'opportunity_evidence', deletion: 'ordered' },
  { table: 'opportunity_qbr_triggers', deletion: 'ordered', clientKeyed: true },
  { table: 'opportunity_suggestions', deletion: 'ordered', clientKeyed: true },
  { table: 'opportunity_meeting_sessions', deletion: 'ordered' },
  { table: 'opportunity_settings', deletion: 'ordered' },
  { table: 'opportunities', deletion: 'ordered', clientKeyed: true, references: [{ table: 'opportunity_suggestions', column: 'suggestion_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
  { table: 'invoice_adjustment_operations', deletion: 'ordered' },
  { table: 'invoice_charges', deletion: 'ordered' },
  { table: 'invoice_annotations', deletion: 'ordered', export: { rank: 18 } },
  { table: 'invoice_time_entries', deletion: 'ordered', export: { rank: 19 } },
  { table: 'invoice_usage_records', deletion: 'ordered' },
  { table: 'invoice_charge_details', deletion: 'ordered' },
  { table: 'invoice_charge_fixed_details', deletion: 'ordered' },
  { table: 'invoice_items', deletion: 'ordered', export: { rank: 17 } },
  { table: 'invoice_autopay_attempts', deletion: 'ordered' },
  { table: 'billing_profile_autopay', deletion: 'ordered', clientKeyed: true },
  { table: 'invoice_payment_links', deletion: 'ordered' },
  { table: 'invoice_payments', deletion: 'ordered' },
  { table: 'payment_confirmation_emails', deletion: 'ordered' },
  { table: 'invoice_template_assignments', deletion: 'ordered' },
  { table: 'hour_block_audit', deletion: 'ordered' },
  { table: 'hour_block_service_scopes', deletion: 'ordered' },
  { table: 'hour_block_time_allocations', deletion: 'ordered' },
  { table: 'hour_blocks', deletion: 'ordered', clientKeyed: true },
  { table: 'contract_line_block_issuances', deletion: 'ordered', clientKeyed: true },
  { table: 'time_tracking_session_segments', deletion: 'ordered' },
  { table: 'time_tracking_sessions', deletion: 'ordered' },
  { table: 'time_entry_suggestion_dismissals', deletion: 'ordered' },
  { table: 'time_sheet_comments', deletion: 'ordered', export: { rank: 10 } },
  { table: 'time_entry_change_requests', deletion: 'ordered' },
  { table: 'time_entries', deletion: 'ordered', export: { rank: 8 } },
  { table: 'time_sheets', deletion: 'ordered', export: { rank: 9 } },
  { table: 'user_cost_rates', deletion: 'ordered' },
  { table: 'document_block_content', deletion: 'ordered', export: { rank: 28 } },
  { table: 'document_versions', deletion: 'ordered', export: { rank: 26 } },
  { table: 'document_content', deletion: 'ordered', export: { rank: 27 } },
  { table: 'document_folders', deletion: 'ordered' },
  { table: 'document_system_entries', deletion: 'ordered' },
  { table: 'ticket_bundle_mirrors', deletion: 'ordered' },
  { table: 'ticket_comment_attachment_challenges', deletion: 'ordered' },
  { table: 'ticket_comment_attachments', deletion: 'ordered' },
  { table: 'ticket_comment_email_deliveries', deletion: 'ordered' },
  { table: 'comment_reactions', deletion: 'ordered' },
  { table: 'vectors', deletion: 'ordered' },
  { table: 'email_reply_tokens', deletion: 'ordered' },
  { table: 'comments', deletion: 'ordered', export: { rank: 7 } },
  { table: 'comment_threads', deletion: 'ordered' },
  { table: 'gmail_processed_history', deletion: 'ordered' },
  { table: 'email_processed_attachments', deletion: 'ordered' },
  { table: 'email_processed_messages', deletion: 'ordered' },
  { table: 'email_sending_logs', deletion: 'ordered' },
  { table: 'email_rate_limits', deletion: 'ordered' },
  { table: 'msp_sso_domain_verification_challenges', deletion: 'ordered' },
  { table: 'msp_sso_tenant_login_domains', deletion: 'ordered' },
  { table: 'microsoft_profile_consumer_bindings', deletion: 'ordered' },
  { table: 'teams_notification_deliveries', deletion: 'ordered' },
  { table: 'teams_audit_events', deletion: 'ordered' },
  { table: 'teams_conversation_references', deletion: 'ordered' },
  { table: 'teams_integrations', deletion: 'ordered' },
  { table: 'microsoft_profiles', deletion: 'ordered', clientKeyed: true },
  { table: 'telephony_call_artifacts', deletion: 'ordered' },
  { table: 'telephony_call_intents', deletion: 'ordered', clientKeyed: true },
  { table: 'telephony_call_records', deletion: 'ordered' },
  { table: 'telephony_chat_records', deletion: 'ordered' },
  { table: 'telephony_providers', deletion: 'ordered' },
  { table: 'authorization_bundle_assignments', deletion: 'ordered' },
  { table: 'authorization_bundle_rules', deletion: 'ordered' },
  { table: 'authorization_bundle_revisions', deletion: 'ordered' },
  { table: 'authorization_bundles', deletion: 'ordered', references: [{ table: 'authorization_bundle_revisions', column: 'published_revision_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
  { table: 'scim_operations', deletion: 'ordered' },
  { table: 'scim_unresolved_identities', deletion: 'ordered' },
  { table: 'scim_user_links', deletion: 'ordered' },
  { table: 'scim_connections', deletion: 'ordered' },
  { table: 'user_activity_group_items', deletion: 'ordered' },
  { table: 'user_activity_groups', deletion: 'ordered' },
  { table: 'user_notification_preferences', deletion: 'ordered' },
  { table: 'user_internal_notification_preferences', deletion: 'ordered' },
  { table: 'user_preferences', deletion: 'ordered' },
  { table: 'role_permissions', deletion: 'ordered' },
  { table: 'user_roles', deletion: 'ordered', export: { rank: 41 } },
  { table: 'user_auth_accounts', deletion: 'ordered' },
  { table: 'mobile_push_tokens', deletion: 'ordered' },
  { table: 'content_reports', deletion: 'ordered' },
  { table: 'user_content_mutes', deletion: 'ordered' },
  { table: 'apple_iap_subscriptions', deletion: 'ordered' },
  { table: 'apple_iap_notifications', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'apple_user_identities', deletion: 'ordered' },
  { table: 'schedule_entry_assignees', deletion: 'ordered' },
  { table: 'schedule_conflicts', deletion: 'ordered' },
  { table: 'team_members', deletion: 'ordered', export: { rank: 39 } },
  { table: 'availability_exceptions', deletion: 'ordered' },
  { table: 'availability_settings', deletion: 'ordered' },
  { table: 'calendar_event_mappings', deletion: 'ordered' },
  { table: 'calendar_provider_health', deletion: 'ordered' },
  { table: 'google_calendar_provider_config', deletion: 'ordered', clientKeyed: true },
  { table: 'microsoft_calendar_provider_config', deletion: 'ordered', clientKeyed: true },
  { table: 'calendar_providers', deletion: 'ordered' },
  { table: 'tag_mappings', deletion: 'ordered', export: { rank: 46 } },
  { table: 'tag_references', deletion: 'ordered' },
  { table: 'tag_display_rules', deletion: 'ordered' },
  { table: 'ticket_resources', deletion: 'ordered', export: { rank: 5 } },
  { table: 'ticket_watchers', deletion: 'ordered' },
  { table: 'document_fetch_hosts', deletion: 'ordered' },
  { table: 'client_portal_visibility_group_boards', deletion: 'ordered' },
  { table: 'import_job_items', deletion: 'ordered' },
  { table: 'import_jobs', deletion: 'ordered' },
  { table: 'migration_record_outcomes', deletion: 'ordered' },
  { table: 'migration_staged_records', deletion: 'ordered' },
  { table: 'migration_job_entities', deletion: 'ordered' },
  { table: 'migration_identity_mappings', deletion: 'ordered' },
  { table: 'migration_reports', deletion: 'ordered' },
  { table: 'migration_mapping_profiles', deletion: 'ordered' },
  { table: 'migration_jobs', deletion: 'ordered' },
  { table: 'job_details', deletion: 'ordered' },
  { table: 'jobs', deletion: 'ordered' },
  { table: 'audit_logs', deletion: 'ordered' },
  { table: 'notification_logs', deletion: 'ordered' },
  { table: 'internal_notifications', deletion: 'ordered' },
  { table: 'platform_notification_recipients', deletion: 'ordered' },
  { table: 'extension_execution_log', deletion: 'ordered' },
  { table: 'extension_execution_log_old', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'extension_quota_usage', deletion: 'ordered' },
  { table: 'extension_quota_usage_old', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'extension_audit_logs', deletion: 'ordered' },
  { table: 'extension_event_subscription', deletion: 'ordered' },
  { table: 'extension_settings', deletion: 'ordered' },
  { table: 'extension_storage', deletion: 'ordered' },
  { table: 'messages', deletion: 'ordered' },
  { table: 'chats', deletion: 'ordered' },
  { table: 'custom_reports', deletion: 'ordered' },
  { table: 'inbound_webhook_deliveries', deletion: 'ordered' },
  { table: 'inbound_webhooks', deletion: 'ordered' },
  { table: 'external_entity_mappings', deletion: 'ordered' },
  { table: 'import_sources', deletion: 'ordered' },
  { table: 'recurring_ticket_client_assets', deletion: 'ordered' },
  { table: 'recurring_ticket_occurrences', deletion: 'ordered', clientKeyed: true },
  { table: 'recurring_ticket_definition_clients', deletion: 'ordered', clientKeyed: true },
  { table: 'recurring_ticket_definitions', deletion: 'ordered' },
  { table: 'ticket_template_checklist_items', deletion: 'ordered' },
  { table: 'ticket_templates', deletion: 'ordered' },
  { table: 'canned_response_favorites', deletion: 'ordered' },
  { table: 'canned_responses', deletion: 'ordered' },
  { table: 'asset_remote_access_links', deletion: 'ordered', export: { rank: 30 } },
  { table: 'asset_maintenance_occurrences', deletion: 'ordered', export: { rank: 35 } },
  { table: 'asset_maintenance_notifications', deletion: 'ordered' },
  { table: 'asset_maintenance_history', deletion: 'ordered' },
  { table: 'asset_service_history', deletion: 'ordered' },
  { table: 'asset_ticket_associations', deletion: 'ordered' },
  { table: 'asset_document_associations', deletion: 'ordered' },
  { table: 'asset_relationships', deletion: 'ordered' },
  { table: 'asset_history', deletion: 'ordered', export: { rank: 31 } },
  { table: 'asset_associations', deletion: 'ordered', export: { rank: 32 } },
  { table: 'asset_software', deletion: 'ordered', export: { rank: 33 } },
  { table: 'asset_facts', deletion: 'ordered' },
  { table: 'workstation_assets', deletion: 'ordered' },
  { table: 'server_assets', deletion: 'ordered' },
  { table: 'network_device_assets', deletion: 'ordered' },
  { table: 'mobile_device_assets', deletion: 'ordered' },
  { table: 'printer_assets', deletion: 'ordered' },
  { table: 'asset_type_registry', deletion: 'ordered' },
  { table: 'asset_statuses', deletion: 'ordered' },
  { table: 'asset_assignments', deletion: 'ordered' },
  { table: 'asset_group_members', deletion: 'ordered' },
  { table: 'asset_group_contacts', deletion: 'ordered' },
  { table: 'asset_groups', deletion: 'ordered', clientKeyed: true },
  { table: 'software_catalog', deletion: 'ordered' },
  { table: 'rmm_webhook_events', deletion: 'ordered' },
  { table: 'rmm_maintenance_windows', deletion: 'ordered', clientKeyed: true },
  { table: 'rmm_alert_rules', deletion: 'ordered' },
  { table: 'rmm_alerts', deletion: 'ordered' },
  { table: 'rmm_organization_mappings', deletion: 'ordered', clientKeyed: true },
  { table: 'rmm_integrations', deletion: 'ordered' },
  { table: 'survey_responses', deletion: 'ordered', clientKeyed: true },
  { table: 'survey_invitations', deletion: 'ordered', clientKeyed: true },
  { table: 'survey_triggers', deletion: 'ordered' },
  { table: 'survey_templates', deletion: 'ordered' },
  { table: 'online_meeting_artifacts', deletion: 'ordered' },
  { table: 'online_meetings', deletion: 'ordered' },
  { table: 'appointment_requests', deletion: 'ordered', clientKeyed: true },
  { table: 'external_entity_links', deletion: 'ordered' },
  { table: 'tenant_external_systems', deletion: 'ordered' },
  { table: 'list_views', deletion: 'ordered' },
  { table: 'sla_notifications_sent', deletion: 'ordered' },
  { table: 'sla_audit_log', deletion: 'ordered' },
  { table: 'ticket_audit_logs', deletion: 'ordered' },
  { table: 'sla_notification_thresholds', deletion: 'ordered' },
  { table: 'sla_policy_targets', deletion: 'ordered' },
  { table: 'status_sla_pause_config', deletion: 'ordered' },
  { table: 'business_hours_entries', deletion: 'ordered' },
  { table: 'holidays', deletion: 'ordered' },
  { table: 'escalation_managers', deletion: 'ordered' },
  { table: 'sla_settings', deletion: 'ordered' },
  { table: 'stripe_webhook_events', deletion: 'ordered' },
  { table: 'stripe_subscriptions', deletion: 'ordered' },
  { table: 'stripe_prices', deletion: 'ordered' },
  { table: 'stripe_products', deletion: 'ordered' },
  { table: 'stripe_customers', deletion: 'ordered' },
  { table: 'stripe_accounts', deletion: 'ordered' },
  { table: 'payment_webhook_events', deletion: 'ordered' },
  { table: 'payment_provider_configs', deletion: 'ordered' },
  { table: 'client_payment_customers', deletion: 'ordered', clientKeyed: true },
  { table: 'tenant_reactivation_tokens', deletion: 'ordered' },
  { table: 'pending_reactivation_refunds', deletion: 'ordered' },
  { table: 'prepaid_balance_alert_deliveries', deletion: 'ordered' },
  { table: 'prepaid_balance_alerts', deletion: 'ordered', clientKeyed: true },
  { table: 'credit_allocations', deletion: 'ordered' },
  { table: 'credit_tracking', deletion: 'ordered', export: { rank: 21 }, clientKeyed: true },
  { table: 'usage_period_total_requests', deletion: 'ordered', clientKeyed: true },
  { table: 'usage_period_totals', deletion: 'ordered', clientKeyed: true },
  { table: 'usage_measurement_revisions', deletion: 'ordered' },
  { table: 'contract_line_unit_pricing_revision_history', deletion: 'ordered' },
  { table: 'contract_recurring_unit_adjustments', deletion: 'ordered', clientKeyed: true },
  { table: 'contract_line_unit_pricing_revisions', deletion: 'ordered' },
  { table: 'billing_semantics_locks', deletion: 'ordered' },
  { table: 'usage_tracking', deletion: 'ordered', clientKeyed: true },
  { table: 'bucket_usage', deletion: 'ordered', clientKeyed: true },
  { table: 'bucket_usage_unmappable_archive', deletion: 'ordered', scope: { scope: 'tenant' }, clientKeyed: true },
  { table: 'recurring_service_periods', deletion: 'ordered' },
  { table: 'transactions', deletion: 'ordered', export: { rank: 20 }, clientKeyed: true },
  { table: 'accounting_export_artifacts', deletion: 'ordered' },
  { table: 'accounting_export_errors', deletion: 'ordered' },
  { table: 'accounting_export_lines', deletion: 'ordered', clientKeyed: true },
  { table: 'accounting_export_batches', deletion: 'ordered' },
  { table: 'accounting_sync_operations', deletion: 'ordered' },
  { table: 'accounting_sync_cycles', deletion: 'ordered' },
  { table: 'contract_line_bucket_services', deletion: 'ordered' },
  { table: 'contract_line_buckets', deletion: 'ordered' },
  { table: 'contract_template_discount_copies', deletion: 'ordered' },
  { table: 'client_contracts', deletion: 'ordered', clientKeyed: true },
  { table: 'contract_line_service_rate_tiers', deletion: 'ordered' },
  { table: 'contract_line_service_bucket_config', deletion: 'ordered' },
  { table: 'contract_line_service_hourly_config', deletion: 'ordered' },
  { table: 'contract_line_service_hourly_configs', deletion: 'ordered' },
  { table: 'contract_line_service_usage_config', deletion: 'ordered' },
  { table: 'contract_line_service_fixed_config', deletion: 'ordered' },
  { table: 'contract_line_service_configuration', deletion: 'ordered' },
  { table: 'contract_line_service_defaults', deletion: 'ordered' },
  { table: 'contract_pricing_schedules', deletion: 'ordered' },
  { table: 'service_catalog_mode_defaults', deletion: 'ordered' },
  { table: 'service_rate_tiers', deletion: 'ordered' },
  { table: 'service_prices', deletion: 'ordered' },
  { table: 'contract_line_discounts', deletion: 'ordered', clientKeyed: true },
  { table: 'contract_discount_assignments', deletion: 'ordered' },
  { table: 'discounts', deletion: 'ordered' },
  { table: 'client_billing_cycles', deletion: 'ordered', clientKeyed: true },
  { table: 'client_billing_settings', deletion: 'ordered', clientKeyed: true },
  { table: 'contract_line_prepaid_blocks', deletion: 'ordered' },
  { table: 'contract_line_services', deletion: 'ordered', export: { rank: 24 } },
  { table: 'contract_lines', deletion: 'ordered', export: { rank: 23 } },
  { table: 'contracts', deletion: 'ordered', export: { rank: 22 } },
  { table: 'contract_line_preset_prepaid_blocks', deletion: 'ordered' },
  { table: 'contract_line_preset_fixed_config', deletion: 'ordered' },
  { table: 'contract_line_preset_services', deletion: 'ordered' },
  { table: 'contract_line_presets', deletion: 'ordered' },
  { table: 'contract_template_prices', deletion: 'ordered' },
  { table: 'contract_template_price_sets', deletion: 'ordered' },
  { table: 'contract_template_line_defaults', deletion: 'ordered' },
  { table: 'contract_template_line_prepaid_blocks', deletion: 'ordered' },
  { table: 'contract_template_line_bucket_services', deletion: 'ordered' },
  { table: 'contract_template_line_buckets', deletion: 'ordered' },
  { table: 'contract_template_line_fixed_config', deletion: 'ordered' },
  { table: 'contract_template_line_service_bucket_config', deletion: 'ordered' },
  { table: 'contract_template_line_service_fixed_config', deletion: 'ordered' },
  { table: 'contract_template_line_service_hourly_config', deletion: 'ordered' },
  { table: 'contract_template_line_service_usage_config', deletion: 'ordered' },
  { table: 'contract_template_line_service_configuration', deletion: 'ordered' },
  { table: 'contract_template_line_services', deletion: 'ordered' },
  { table: 'contract_template_line_terms', deletion: 'ordered' },
  { table: 'contract_template_lines', deletion: 'ordered' },
  { table: 'contract_template_pricing_schedules', deletion: 'ordered' },
  { table: 'contract_template_services', deletion: 'ordered' },
  { table: 'contract_templates', deletion: 'ordered' },
  { table: 'client_tax_rates', deletion: 'ordered', clientKeyed: true },
  { table: 'client_tax_settings', deletion: 'ordered', clientKeyed: true },
  { table: 'client_inbound_email_domains', deletion: 'ordered', clientKeyed: true },
  { table: 'client_name_aliases', deletion: 'ordered', clientKeyed: true },
  { table: 'tenant_companies', deletion: 'ordered', clientKeyed: true },
  { table: 'entra_contact_reconciliation_queue', deletion: 'ordered', clientKeyed: true },
  { table: 'entra_contact_links', deletion: 'ordered', clientKeyed: true },
  { table: 'entra_managed_tenant_user_filters', deletion: 'ordered' },
  { table: 'entra_client_tenant_mappings', deletion: 'ordered', clientKeyed: true },
  { table: 'entra_sync_run_tenants', deletion: 'ordered', clientKeyed: true },
  { table: 'entra_sync_runs', deletion: 'ordered' },
  { table: 'entra_managed_tenants', deletion: 'ordered' },
  { table: 'entra_partner_connections', deletion: 'ordered' },
  { table: 'entra_sync_settings', deletion: 'ordered' },
  { table: 'hudu_integrations', deletion: 'ordered' },
  { table: 'provider_disconnect_records', deletion: 'ordered' },
  { table: 'project_billing_schedule_entries', deletion: 'ordered' },
  { table: 'project_billing_cap_usage', deletion: 'ordered' },
  { table: 'project_billing_configs', deletion: 'ordered' },
  { table: 'project_phase_rate_overrides', deletion: 'ordered' },
  { table: 'project_tasks', deletion: 'ordered', export: { rank: 13 } },
  { table: 'project_phases', deletion: 'ordered', export: { rank: 12 } },
  { table: 'project_status_mappings', deletion: 'ordered' },
  { table: 'projects', deletion: 'ordered', export: { rank: 11 }, clientKeyed: true },
  { table: 'workflow_tasks', deletion: 'ordered', export: { rank: 47 } },
  { table: 'workflow_form_definitions', deletion: 'ordered' },
  { table: 'workflow_task_definitions', deletion: 'ordered' },
  { table: 'service_request_submission_application_results', deletion: 'ordered' },
  { table: 'service_request_submission_applications', deletion: 'ordered' },
  { table: 'service_request_answer_mapping_versions', deletion: 'ordered' },
  { table: 'service_request_answer_mappings', deletion: 'ordered' },
  { table: 'service_request_submission_attachments', deletion: 'ordered' },
  { table: 'service_request_submissions', deletion: 'ordered', clientKeyed: true },
  { table: 'service_request_definition_versions', deletion: 'ordered' },
  { table: 'service_request_definitions', deletion: 'ordered' },
  { table: 'co_management_board_scopes', deletion: 'ordered' },
  { table: 'co_managed_allocations', deletion: 'ordered' },
  { table: 'co_managed_entitlements', deletion: 'ordered' },
  { table: 'co_managed_provisioning_operations', deletion: 'ordered' },
  { table: 'co_managed_purchase_operations', deletion: 'ordered' },
  { table: 'tenant_license_state', deletion: 'ordered' },
  { table: 'co_managed_meeting_creation_operations', deletion: 'ordered' },
  { table: 'co_management_relationship_events', deletion: 'ordered' },
  { table: 'co_management_delegated_receipts', deletion: 'ordered' },
  { table: 'co_management_delegated_grants', deletion: 'ordered' },
  { table: 'co_management_project_scopes', deletion: 'ordered' },
  { table: 'co_management_staff_assignments', deletion: 'ordered' },
  { table: 'co_managed_project_task_references', deletion: 'ordered', clientKeyed: true },
  { table: 'collaboration_actor_references', deletion: 'ordered' },
  { table: 'co_managed_participation_evidence', deletion: 'ordered', clientKeyed: true },
  { table: 'co_management_ticket_handoffs', deletion: 'ordered' },
  { table: 'co_management_ticket_work', deletion: 'ordered' },
  { table: 'co_managed_ticket_references', deletion: 'ordered', clientKeyed: true },
  { table: 'co_management_command_receipts', deletion: 'ordered' },
  { table: 'co_management_relationships', deletion: 'ordered' },
  { table: 'document_share_access_log', deletion: 'ordered' },
  { table: 'document_share_links', deletion: 'ordered' },
  { table: 'kb_import_files', deletion: 'ordered' },
  { table: 'kb_article_relations', deletion: 'ordered' },
  { table: 'kb_article_reviewers', deletion: 'ordered' },
  { table: 'kb_article_templates', deletion: 'ordered' },
  { table: 'kb_articles', deletion: 'ordered' },
  { table: 'document_default_folders', deletion: 'ordered' },
  { table: 'document_folder_template_items', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'document_entity_folder_init', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'document_folder_templates', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'document_associations', deletion: 'ordered' },
  { table: 'credential_associations', deletion: 'ordered' },
  { table: 'credential_access_grants', deletion: 'ordered' },
  { table: 'credentials', deletion: 'ordered', clientKeyed: true },
  { table: 'asset_maintenance_schedules', deletion: 'ordered', export: { rank: 34 } },
  { table: 'assets', deletion: 'ordered', export: { rank: 29 }, clientKeyed: true, references: [{ table: 'stock_units', column: 'stock_unit_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
  { table: 'vendors', deletion: 'ordered' },
  { table: 'payment_methods', deletion: 'ordered', clientKeyed: true },
  { table: 'schedule_entries', deletion: 'ordered', export: { rank: 37 } },
  { table: 'calendar_shares', deletion: 'ordered' },
  { table: 'calendars', deletion: 'ordered' },
  { table: 'service_catalog', deletion: 'ordered', export: { rank: 43 } },
  { table: 'service_types', deletion: 'ordered' },
  { table: 'service_categories', deletion: 'ordered', export: { rank: 44 } },
  { table: 'tenant_units_of_measure', deletion: 'ordered' },
  { table: 'approval_thresholds', deletion: 'ordered' },
  { table: 'conditional_display_rules', deletion: 'ordered' },
  { table: 'layout_blocks', deletion: 'ordered' },
  { table: 'template_sections', deletion: 'ordered' },
  { table: 'invoice_templates', deletion: 'ordered' },
  { table: 'invoices', deletion: 'ordered', export: { rank: 16 }, clientKeyed: true },
  { table: 'file_upload_session_files', deletion: 'ordered' },
  { table: 'file_upload_sessions', deletion: 'ordered' },
  { table: 'external_files', deletion: 'ordered' },
  { table: 'documents', deletion: 'ordered', export: { rank: 25 } },
  { table: 'document_types', deletion: 'ordered' },
  { table: 'ticket_auto_close_state', deletion: 'ordered' },
  { table: 'board_auto_close_rules', deletion: 'ordered' },
  { table: 'ticket_checklist_items', deletion: 'ordered' },
  { table: 'checklist_template_apply_rules', deletion: 'ordered' },
  { table: 'checklist_template_items', deletion: 'ordered' },
  { table: 'checklist_templates', deletion: 'ordered', clientKeyed: true },
  { table: 'board_close_rules', deletion: 'ordered' },
  { table: 'board_notification_rule_recipients', deletion: 'ordered' },
  { table: 'board_notification_rule_statuses', deletion: 'ordered' },
  { table: 'board_notification_rules', deletion: 'ordered' },
  { table: 'board_default_watchers', deletion: 'ordered' },
  { table: 'ticket_bundle_settings', deletion: 'ordered' },
  { table: 'ticket_entity_links', deletion: 'ordered' },
  { table: 'ticket_bundle_status_propagations', deletion: 'ordered' },
  { table: 'tickets', deletion: 'ordered', export: { rank: 4 }, clientKeyed: true },
  { table: 'client_locations', deletion: 'ordered', clientKeyed: true },
  { table: 'categories', deletion: 'ordered' },
  { table: 'boards', deletion: 'ordered' },
  { table: 'statuses', deletion: 'ordered', references: [{ table: 'boards', column: 'board_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
  { table: 'priorities', deletion: 'ordered' },
  { table: 'severities', deletion: 'ordered' },
  { table: 'urgencies', deletion: 'ordered' },
  { table: 'impacts', deletion: 'ordered' },
  { table: 'tax_components', deletion: 'ordered' },
  { table: 'permissions', deletion: 'ordered' },
  { table: 'roles', deletion: 'ordered', export: { rank: 40 } },
  { table: 'teams', deletion: 'ordered', export: { rank: 38 } },
  { table: 'tenant_secrets_audit_log', deletion: 'ordered' },
  { table: 'tenant_secrets', deletion: 'ordered' },
  { table: 'contact_phone_numbers', deletion: 'ordered' },
  { table: 'contact_additional_email_addresses', deletion: 'ordered' },
  { table: 'contact_phone_type_definitions', deletion: 'ordered' },
  { table: 'client_portal_visibility_groups', deletion: 'ordered', clientKeyed: true },
  { table: 'portal_invitations', deletion: 'ordered' },
  { table: 'user_invitations', deletion: 'ordered' },
  { table: 'client_portal_user_billing_profiles', deletion: 'ordered' },
  { table: 'billing_profile_contacts', deletion: 'ordered' },
  { table: 'client_billing_profiles', deletion: 'ordered', clientKeyed: true },
  { table: 'client_merges', deletion: 'ordered' },
  { table: 'client_tax_id_migration_conflicts', deletion: 'ordered', clientKeyed: true },
  { table: 'clients', deletion: 'ordered', export: { rank: 3 }, clientKeyed: true, references: [{ table: 'users', column: 'account_manager_id', onDelete: 'NONE', resolution: 'null-before-delete' }] },
  { table: 'contacts', deletion: 'ordered', export: { rank: 1 }, clientKeyed: true, references: [{ table: 'clients', column: 'client_id', onDelete: 'CASCADE', resolution: 'null-before-delete' }] },
  { table: 'contact_email_type_definitions', deletion: 'ordered' },
  { table: 'password_reset_tokens', deletion: 'ordered' },
  { table: 'resources', deletion: 'ordered' },
  { table: 'user_work_schedules', deletion: 'ordered' },
  { table: 'tenant_telemetry_settings', deletion: 'ordered' },
  { table: 'agent_roles', deletion: 'ordered' },
  { table: 'mcp_agent_audit', deletion: 'ordered' },
  { table: 'agent_idp_providers', deletion: 'ordered' },
  { table: 'agents', deletion: 'ordered' },
  { table: 'mcp_oauth_auth_codes', deletion: 'ordered', scope: { scope: 'tenant' }, clientKeyed: true },
  { table: 'mcp_oauth_refresh_tokens', deletion: 'ordered', scope: { scope: 'tenant' } },
  { table: 'mcp_oauth_grants', deletion: 'ordered', scope: { scope: 'tenant' }, clientKeyed: true },
  { table: 'users', deletion: 'ordered', export: { rank: 0 } },
  { table: 'sla_policies', deletion: 'ordered' },
  { table: 'business_hours_schedules', deletion: 'ordered' },
  { table: 'webhook_event_receipts', deletion: 'ordered' },
  { table: 'webhook_deliveries', deletion: 'ordered' },
  { table: 'webhooks', deletion: 'ordered' },
  { table: 'api_rate_limit_settings', deletion: 'ordered' },
  { table: 'mobile_auth_otts', deletion: 'ordered' },
  { table: 'mobile_refresh_tokens', deletion: 'ordered' },
  { table: 'api_keys', deletion: 'ordered' },
  { table: 'portal_domain_session_otts', deletion: 'ordered' },
  { table: 'portal_domains', deletion: 'ordered' },
  { table: 'policies', deletion: 'ordered' },
  { table: 'google_email_provider_config', deletion: 'ordered', clientKeyed: true },
  { table: 'microsoft_email_provider_config', deletion: 'ordered', clientKeyed: true },
  { table: 'imap_email_provider_config', deletion: 'ordered' },
  { table: 'email_provider_health', deletion: 'ordered' },
  { table: 'email_provider_configs', deletion: 'ordered' },
  { table: 'email_providers', deletion: 'ordered' },
  { table: 'email_templates', deletion: 'ordered' },
  { table: 'email_domains', deletion: 'ordered' },
  { table: 'tenant_email_settings', deletion: 'ordered' },
  { table: 'storage_records', deletion: 'ordered' },
  { table: 'storage_schemas', deletion: 'ordered' },
  { table: 'storage_usage', deletion: 'ordered' },
  { table: 'storage_configurations', deletion: 'ordered' },
  { table: 'provider_events', deletion: 'ordered' },
  { table: 'storage_providers', deletion: 'ordered' },
  { table: 'ext_storage_records', deletion: 'ordered' },
  { table: 'ext_storage_schemas', deletion: 'ordered' },
  { table: 'ext_storage_usage', deletion: 'ordered' },
  { table: 'tenant_email_templates', deletion: 'ordered' },
  { table: 'approval_levels', deletion: 'ordered' },
  { table: 'attribute_definitions', deletion: 'ordered' },
  { table: 'custom_fields', deletion: 'ordered' },
  { table: 'tag_definitions', deletion: 'ordered' },
  { table: 'custom_task_types', deletion: 'ordered' },
  { table: 'tenant_time_period_settings', deletion: 'ordered' },
  { table: 'time_period_calendar_locks', deletion: 'ordered' },
  { table: 'time_periods', deletion: 'ordered' },
  { table: 'time_period_types', deletion: 'ordered' },
  { table: 'time_period_settings', deletion: 'ordered' },
  { table: 'external_tax_imports', deletion: 'ordered' },
  { table: 'tenant_internal_notification_category_settings', deletion: 'ordered' },
  { table: 'tenant_internal_notification_subtype_settings', deletion: 'ordered' },
  { table: 'tenant_notification_category_settings', deletion: 'ordered' },
  { table: 'tenant_notification_subtype_settings', deletion: 'ordered' },
  { table: 'tenant_external_entity_mappings', deletion: 'ordered' },
  { table: 'telemetry_consent_log', deletion: 'ordered' },
  { table: 'default_billing_settings', deletion: 'ordered' },
  { table: 'notification_settings', deletion: 'ordered' },
  { table: 'inbound_email_rules', deletion: 'ordered' },
  { table: 'inbound_ticket_defaults', deletion: 'ordered', clientKeyed: true, references: [{ table: 'clients', column: 'client_id', onDelete: 'CASCADE', resolution: 'null-before-delete' }] },
  { table: 'user_type_rates', deletion: 'ordered' },
  { table: 'next_number', deletion: 'ordered' },
  { table: 'event_catalog', deletion: 'ordered' },
  { table: 'inbound_email_event_deliveries', deletion: 'ordered' },
  { table: 'inbound_email_effects', deletion: 'ordered' },
  { table: 'inbound_email_artifacts', deletion: 'ordered' },
  { table: 'inbound_email_outbox', deletion: 'ordered' },
  { table: 'inbound_email_inbox', deletion: 'ordered' },
  { table: 'inbound_email_ingress', deletion: 'ordered' },
  { table: 'tenant_extension_schedule', deletion: 'ordered' },
  { table: 'tenant_extension_install_secrets', deletion: 'ordered' },
  { table: 'tenant_extension_install_config', deletion: 'ordered' },
  { table: 'tenant_extension_install', deletion: 'ordered' },
  { table: 'extensions', deletion: 'ordered' },
  { table: 'tenant_addons', deletion: 'ordered' },
  { table: 'tenant_settings', deletion: 'ordered' },
  { table: 'tax_rates', deletion: 'ordered' },
  { table: 'tax_regions', deletion: 'ordered' },
  // Not deleted by the loop.
  { table: 'tenants', deletion: 'excluded', reason: "The tenant row itself; deleted last, separately, by the workflow." },
  { table: 'pending_tenant_deletions', deletion: 'excluded', reason: "Deletion workflow bookkeeping; managed separately." },
  { table: 'knex_migrations', deletion: 'excluded', reason: "Knex internal." },
  { table: 'knex_migrations_lock', deletion: 'excluded', reason: "Knex internal." },
  { table: 'spatial_ref_sys', deletion: 'excluded', reason: "PostGIS system table." },
  { table: 'companies', deletion: 'excluded', reason: "Export-list name with no tenant-keyed table in the schema; the exporter skips tables it cannot resolve.", export: { rank: 2 } },
  { table: 'schedules', deletion: 'excluded', reason: "Export-list name with no tenant-keyed table in the schema; the exporter skips tables it cannot resolve.", export: { rank: 36 } },
  { table: 'tags', deletion: 'excluded', reason: "Export-list name with no tenant-keyed table in the schema; the exporter skips tables it cannot resolve.", export: { rank: 45 } },
];
