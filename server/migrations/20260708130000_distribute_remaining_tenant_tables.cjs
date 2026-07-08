/**
 * Converge the Citus topology: distribute every remaining tenant table and
 * convert global catalog tables to reference tables.
 *
 * Two gaps are closed at once (see 20260708120000 for the backstory):
 *  - Rebuild parity: ~99 tables were distributed on production out-of-band in
 *    2025 (ee/server/migrations/citus, executed manually, folder since removed)
 *    but a greenfield rebuild left them LOCAL. For those, production's current
 *    shape (tenant-composite PKs, dropped triggers, composite FKs) is the spec
 *    this migration reproduces; on production itself they are no-ops.
 *  - Backlog: ~110 tenant tables created after the 2025 wave were never
 *    distributed anywhere. Largest is ~50 MB, so data movement is trivial.
 *
 * Deliberately NOT distributed (documented decisions, revisit separately):
 *   - agent_idp_providers
 *   - agent_roles
 *   - agents
 *   - api_keys
 *   - asset_software
 *   - audit_logs
 *   - credit_reconciliation_reports
 *   - extension_event_subscription
 *   - extension_execution_log
 *   - extension_execution_log_old
 *   - extension_quota_usage
 *   - extension_quota_usage_old
 *   - extension_settings
 *   - extension_storage
 *   - extensions
 *   - mcp_agent_audit
 *   - mcp_oauth_auth_codes
 *   - mcp_oauth_grants
 *   - mcp_oauth_refresh_tokens
 *   - mobile_auth_otts
 *   - mobile_refresh_tokens
 *   - pending_tenant_deletions
 *   - portal_domain_session_otts
 *   - portal_domains
 *   - rmm_alert_rules
 *   - rmm_alerts
 *   - rmm_integrations
 *   - rmm_maintenance_windows
 *   - rmm_organization_mappings
 *   - software_catalog
 *   - stripe_accounts
 *   - stripe_customers
 *   - stripe_prices
 *   - stripe_products
 *   - stripe_subscriptions
 *   - stripe_webhook_events
 *   - tenant_extension_install
 *   - tenant_extension_install_config
 *   - tenant_extension_install_secrets
 *   - tenant_extension_schedule
 *   - system_event_catalog (local on production too; carries a trigger)
 *   Reasons: auth-token tables are looked up by bare token (no tenant in hand);
 *   stripe_* and pending_tenant_deletions are control-plane, queried by external id
 *   across tenants; rmm_*, audit_logs and software_catalog carry triggers that Citus
 *   distribution would drop (needs a product call); agents, mcp_* and extension
 *   family have varchar tenant columns that cannot colocate with the uuid
 *   tenants group (needs a column-type migration first).
 *
 * Idempotent throughout: already-distributed tables, already-converted
 * reference tables, and plain PostgreSQL are all no-ops.
 */
exports.config = { transaction: false };

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

// Tenant-composite PK shapes (production-mirrored for the rebuild-parity group,
// house rule (tenant, id) for the rest). Rebuilt only when the current PK lacks
// the tenant column; DROP ... CASCADE removes dependent FKs, recreated below.
const PK_REBUILDS = {
  "bucket_usage": "tenant, usage_id",
  "contract_templates": "tenant, template_id",
  "contract_template_lines": "tenant, template_line_id",
  "interaction_types": "tenant, type_id",
  "interactions": "tenant, interaction_id",
  "invoice_time_entries": "invoice_time_entry_id, tenant",
  "invoice_usage_records": "invoice_usage_record_id, tenant",
  "permissions": "tenant, permission_id",
  "service_types": "tenant, id",
  "tax_components": "tenant, tax_component_id",
  "time_entries": "tenant, entry_id",
  "usage_tracking": "tenant, usage_id",
  "document_system_entries": "tenant, entry_id",
  "document_template_assignments": "tenant, assignment_id",
  "external_tax_imports": "tenant, import_id",
  "invoice_payments": "tenant, payment_id",
  "invoice_template_assignments": "tenant, assignment_id",
  "service_prices": "tenant, price_id",
  "user_internal_notification_preferences": "tenant, preference_id"
};

// FKs to (re)create after PK rebuilds + distribution, in production shape.
const FK_RECREATE = {
  "bucket_usage": [
    ["bucket_usage_contract_line_fk", "FOREIGN KEY (tenant, contract_line_id) REFERENCES contract_lines(tenant, contract_line_id) ON DELETE CASCADE"],
    ["bucket_usage_tenant_client_id_foreign", "FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)"],
    ["bucket_usage_tenant_foreign", "FOREIGN KEY (tenant) REFERENCES tenants(tenant)"]
  ],
  "contract_template_lines": [
    ["contract_template_lines_template_fk", "FOREIGN KEY (tenant, template_id) REFERENCES contract_templates(tenant, template_id) NOT VALID"]
  ],
  "contract_templates": [
    ["contract_templates_tenant_fk", "FOREIGN KEY (tenant) REFERENCES tenants(tenant) NOT VALID"]
  ],
  "interaction_types": [
    ["interaction_types_system_type_id_foreign", "FOREIGN KEY (system_type_id) REFERENCES system_interaction_types(type_id) ON DELETE SET NULL"],
    ["interaction_types_tenant_foreign", "FOREIGN KEY (tenant) REFERENCES tenants(tenant)"]
  ],
  "interactions": [
    ["interactions_project_fk", "FOREIGN KEY (tenant, project_id) REFERENCES projects(tenant, project_id)"],
    ["interactions_status_fk", "FOREIGN KEY (tenant, status_id) REFERENCES statuses(tenant, status_id)"],
    ["interactions_tenant_client_id_foreign", "FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)"],
    ["interactions_tenant_contact_name_id_foreign", "FOREIGN KEY (tenant, contact_name_id) REFERENCES contacts(tenant, contact_name_id)"],
    ["interactions_tenant_foreign", "FOREIGN KEY (tenant) REFERENCES tenants(tenant)"],
    ["interactions_tenant_ticket_id_foreign", "FOREIGN KEY (tenant, ticket_id) REFERENCES tickets(tenant, ticket_id)"],
    ["interactions_tenant_user_id_foreign", "FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)"]
  ],
  "invoice_time_entries": [
    ["invoice_time_entries_entry_id_foreign", "FOREIGN KEY (entry_id, tenant) REFERENCES time_entries(entry_id, tenant)"],
    ["invoice_time_entries_invoice_id_foreign", "FOREIGN KEY (invoice_id, tenant) REFERENCES invoices(invoice_id, tenant)"]
  ],
  "invoice_usage_records": [
    ["invoice_usage_records_invoice_id_foreign", "FOREIGN KEY (invoice_id, tenant) REFERENCES invoices(invoice_id, tenant)"],
    ["invoice_usage_records_usage_tracking_tenant_usage_id_fk", "FOREIGN KEY (tenant, usage_id) REFERENCES usage_tracking(tenant, usage_id)"]
  ],
  "permissions": [
    ["permissions_tenant_foreign", "FOREIGN KEY (tenant) REFERENCES tenants(tenant)"]
  ],
  "service_types": [
    ["service_types_tenant_id_foreign", "FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE"],
    ["service_types_standard_service_type_id_foreign", "FOREIGN KEY (standard_service_type_id) REFERENCES standard_service_types(id) ON DELETE SET NULL"]
  ],
  "user_internal_notification_preferences": [
    ["user_internal_notification_preferences_category_id_foreign", "FOREIGN KEY (category_id) REFERENCES internal_notification_categories(internal_notification_category_id) ON DELETE CASCADE"],
    ["user_internal_notification_preferences_subtype_id_foreign", "FOREIGN KEY (subtype_id) REFERENCES internal_notification_subtypes(internal_notification_subtype_id) ON DELETE CASCADE"]
  ],
  "authorization_bundles": [
    ["authorization_bundles_tenant_published_revision_id_foreign", "FOREIGN KEY (tenant, published_revision_id) REFERENCES authorization_bundle_revisions(tenant, revision_id)"]
  ],
  "tax_components": [
    ["tax_components_tax_rates_tax_rate_id_tenant_fk", "FOREIGN KEY (tax_rate_id, tenant) REFERENCES tax_rates(tax_rate_id, tenant)"]
  ],
  "time_entries": [
    ["time_entries_tax_rate_id_foreign", "FOREIGN KEY (tax_rate_id, tenant) REFERENCES tax_rates(tax_rate_id, tenant)"],
    ["time_entries_tenant_created_by_foreign", "FOREIGN KEY (tenant, created_by) REFERENCES users(tenant, user_id)"],
    ["time_entries_tenant_service_id_foreign", "FOREIGN KEY (tenant, service_id) REFERENCES service_catalog(tenant, service_id)"],
    ["time_entries_tenant_time_sheet_id_foreign", "FOREIGN KEY (tenant, time_sheet_id) REFERENCES time_sheets(tenant, id)"],
    ["time_entries_tenant_updated_by_foreign", "FOREIGN KEY (tenant, updated_by) REFERENCES users(tenant, user_id)"],
    ["time_entries_tenant_user_id_foreign", "FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)"]
  ],
  "usage_tracking": [
    ["usage_tracking_contract_line_fk", "FOREIGN KEY (tenant, contract_line_id) REFERENCES contract_lines(tenant, contract_line_id) ON DELETE CASCADE"],
    ["usage_tracking_tenant_client_id_foreign", "FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)"],
    ["usage_tracking_tenant_service_id_foreign", "FOREIGN KEY (tenant, service_id) REFERENCES service_catalog(tenant, service_id)"]
  ],
  "contract_template_line_defaults": [
    ["contract_tpl_line_defaults_line_fk", "FOREIGN KEY (tenant, template_line_id) REFERENCES contract_template_lines(tenant, template_line_id) ON DELETE CASCADE"]
  ],
  "contract_template_line_fixed_config": [
    ["contract_tpl_fixed_config_line_fk", "FOREIGN KEY (tenant, template_line_id) REFERENCES contract_template_lines(tenant, template_line_id) ON DELETE CASCADE"]
  ],
  "contract_template_line_services": [
    ["contract_template_line_services_line_fk", "FOREIGN KEY (tenant, template_line_id) REFERENCES contract_template_lines(tenant, template_line_id) ON DELETE CASCADE"]
  ],
  "contract_template_line_terms": [
    ["contract_tpl_line_terms_line_fk", "FOREIGN KEY (tenant, template_line_id) REFERENCES contract_template_lines(tenant, template_line_id) ON DELETE CASCADE"]
  ],
  "contract_template_pricing_schedules": [
    ["contract_tpl_pricing_template_fk", "FOREIGN KEY (tenant, template_id) REFERENCES contract_templates(tenant, template_id) ON DELETE CASCADE"]
  ],
  "role_permissions": [
    ["role_permissions_tenant_permission_id_foreign", "FOREIGN KEY (tenant, permission_id) REFERENCES permissions(tenant, permission_id)"]
  ]
};

// Triggers production dropped when distributing (Citus cannot distribute a
// table with triggers); dropping matches the production schema.
const TRIGGER_DROPS = {
  "interactions": ["validate_interaction_type_trigger"]
};

// Single-column unique indexes production dropped when distributing (Citus
// requires the distribution column in every unique index). The composite PKs
// rebuilt above supersede them; CASCADE removes the single-column FKs that
// depended on them, which FK_RECREATE restores in composite form.
const UNIQUE_INDEX_DROPS = [
  ['time_entries', 'time_entries_entry_id_unique'],
  ['usage_tracking', 'usage_tracking_usage_id_unique'],
  ['contract_templates', 'contract_templates_template_id_unique'],
  ['tax_components', 'tax_components_tax_component_id_idx'],
];

// Composite FKs with ON DELETE SET NULL: Citus 12.1 rejects them on distributed
// tables outright (SET NULL would touch the distribution column; even the
// PG15 column-limited form is refused, at distribute AND at ADD CONSTRAINT
// time). Swapped for plain (NO ACTION) FKs — the shape production's quotes
// family ended up with when it was distributed. Deleting a referenced row now
// blocks instead of auto-nulling, same as production behaves today.
const SET_NULL_FK_SWAPS = {
  "document_template_assignments": [
    ["document_template_assignments_tenant_template_id_foreign", "FOREIGN KEY (tenant, template_id) REFERENCES document_templates(tenant, template_id)"],
    ["document_template_assignments_tenant_created_by_foreign", "FOREIGN KEY (tenant, created_by) REFERENCES users(tenant, user_id)"],
  ],
};

// FK cycle: authorization_bundles.published_revision_id <-> revisions.bundle_id.
// The published-revision edge is dropped, all four tables distribute in
// dependency order, and the edge is restored by FK_RECREATE.
const CYCLE_FK_DROPS = {
  "authorization_bundles": ["authorization_bundles_tenant_published_revision_id_foreign"],
};

// Inbound FKs from tenant tables to soon-to-be reference tables. Converting a
// reference target while a local referrer still points at it drags the referrer
// into citus-local conversion, which then trips on the referrer's own FK to a
// distributed table (e.g. tenants). Dropped before conversion, restored by
// FK_RECREATE once the referrer is distributed (distributed -> reference FKs
// are legal — production carries exactly these shapes).
const REFERENCE_INBOUND_FK_DROPS = {
  "standard_service_types": [["service_types", "service_types_standard_service_type_id_foreign"]],
  "system_interaction_types": [["interaction_types", "interaction_types_system_type_id_foreign"]],
  "internal_notification_categories": [["user_internal_notification_preferences", "user_internal_notification_preferences_category_id_foreign"]],
  "internal_notification_subtypes": [["user_internal_notification_preferences", "user_internal_notification_preferences_subtype_id_foreign"]],
};

// Global catalogs -> reference tables (replicated to workers). Outbound FKs are
// dropped first: a reference table cannot reference a distributed table.
// Matches production, where these carry no FKs.
const REFERENCE_TABLES = [
  'countries',
  'standard_boards',
  'standard_categories',
  'standard_invoice_templates',
  'standard_priorities',
  'standard_service_types',
  'standard_task_types',
  'system_interaction_types',
  'tenant_companies',
  'time_period_settings',
  'internal_notification_categories',
  'internal_notification_subtypes',
  'internal_notification_templates',
  'standard_quote_document_templates'
];

// FK-dependency (topological) order: referenced tables come first.
const DISTRIBUTE_IN_ORDER = [
  ['approval_levels', 'tenant'],
  ['approval_thresholds', 'tenant'],
  ['asset_associations', 'tenant'],
  ['asset_document_associations', 'tenant'],
  ['asset_history', 'tenant'],
  ['asset_maintenance_schedules', 'tenant'],
  ['asset_maintenance_history', 'tenant'],
  ['asset_maintenance_notifications', 'tenant'],
  ['asset_relationships', 'tenant'],
  ['asset_service_history', 'tenant'],
  ['asset_ticket_associations', 'tenant'],
  ['attribute_definitions', 'tenant'],
  ['bucket_usage', 'tenant'],
  ['calendar_event_mappings', 'tenant'],
  ['calendar_providers', 'tenant'],
  ['calendar_provider_health', 'tenant'],
  ['chats', 'tenant'],
  ['client_billing_cycles', 'tenant'],
  ['client_billing_settings', 'tenant'],
  ['client_payment_customers', 'tenant'],
  ['client_portal_visibility_groups', 'tenant'],
  ['client_portal_visibility_group_boards', 'tenant'],
  ['client_tax_rates', 'tenant'],
  ['client_tax_settings', 'tenant'],
  ['conditional_display_rules', 'tenant'],
  ['contract_line_discounts', 'tenant'],
  ['contract_line_presets', 'tenant'],
  ['contract_line_preset_fixed_config', 'tenant'],
  ['contract_line_preset_services', 'tenant'],
  ['contract_line_service_bucket_config', 'tenant'],
  ['contract_line_service_defaults', 'tenant'],
  ['contract_line_service_fixed_config', 'tenant'],
  ['contract_line_service_hourly_config', 'tenant'],
  ['contract_line_service_rate_tiers', 'tenant'],
  ['contract_line_service_usage_config', 'tenant'],
  ['contract_line_services', 'tenant'],
  ['contract_pricing_schedules', 'tenant'],
  ['contract_template_services', 'tenant'],
  ['contract_templates', 'tenant'],
  ['contract_template_lines', 'tenant'],
  ['contract_template_line_defaults', 'tenant'],
  ['contract_template_line_fixed_config', 'tenant'],
  ['contract_template_line_services', 'tenant'],
  ['contract_template_line_service_configuration', 'tenant'],
  ['contract_template_line_service_bucket_config', 'tenant'],
  ['contract_template_line_service_hourly_config', 'tenant'],
  ['contract_template_line_service_usage_config', 'tenant'],
  ['contract_template_line_terms', 'tenant'],
  ['contract_template_pricing_schedules', 'tenant'],
  ['credit_allocations', 'tenant'],
  ['custom_fields', 'tenant'],
  ['custom_task_types', 'tenant'],
  ['default_billing_settings', 'tenant'],
  ['discounts', 'tenant'],
  ['document_associations', 'tenant'],
  ['document_content', 'tenant'],
  ['document_system_entries', 'tenant'],
  ['document_template_assignments', 'tenant'],
  ['document_versions', 'tenant'],
  ['document_block_content', 'tenant'],
  ['email_domains', 'tenant'],
  ['email_provider_configs', 'tenant'],
  ['email_provider_health', 'tenant'],
  ['email_providers', 'tenant'],
  ['email_rate_limits', 'tenant'],
  ['email_sending_logs', 'tenant'],
  ['email_templates', 'tenant'],
  ['escalation_managers', 'tenant'],
  ['event_catalog', 'tenant'],
  ['external_tax_imports', 'tenant'],
  ['gmail_processed_history', 'tenant'],
  ['import_sources', 'tenant'],
  ['external_entity_mappings', 'tenant'],
  ['interactions', 'tenant'],
  ['internal_notifications', 'tenant'],
  ['invoice_annotations', 'tenant'],
  ['invoice_charge_details', 'tenant'],
  ['invoice_charge_fixed_details', 'tenant'],
  ['invoice_payment_links', 'tenant'],
  ['invoice_payments', 'tenant'],
  ['invoice_template_assignments', 'tenant'],
  ['jobs', 'tenant'],
  ['import_jobs', 'tenant'],
  ['import_job_items', 'tenant'],
  ['job_details', 'tenant'],
  ['messages', 'tenant'],
  ['mobile_device_assets', 'tenant'],
  ['network_device_assets', 'tenant'],
  ['next_number', 'tenant'],
  ['notification_settings', 'tenant'],
  ['password_reset_tokens', 'tenant'],
  ['payment_methods', 'tenant'],
  ['payment_provider_configs', 'tenant'],
  ['payment_webhook_events', 'tenant'],
  ['permissions', 'tenant'],
  ['policies', 'tenant'],
  ['portal_invitations', 'tenant'],
  ['printer_assets', 'tenant'],
  ['project_materials', 'tenant'],
  ['project_task_dependencies', 'tenant'],
  ['project_ticket_links', 'tenant'],
  ['provider_events', 'tenant'],
  ['recurring_service_periods', 'tenant'],
  ['resources', 'tenant'],
  ['roles', 'tenant'],
  ['role_permissions', 'tenant'],
  ['schedule_entries', 'tenant'],
  ['schedule_conflicts', 'tenant'],
  ['schedule_entry_assignees', 'tenant'],
  ['server_assets', 'tenant'],
  ['service_prices', 'tenant'],
  ['service_rate_tiers', 'tenant'],
  ['sessions', 'tenant'],
  ['service_types', 'tenant'],
  ['storage_records', 'tenant'],
  ['storage_schemas', 'tenant'],
  ['storage_usage', 'tenant'],
  ['survey_templates', 'tenant'],
  ['survey_invitations', 'tenant'],
  ['survey_responses', 'tenant'],
  ['survey_triggers', 'tenant'],
  ['interaction_types', 'tenant'],
  ['tag_definitions', 'tenant'],
  ['tag_mappings', 'tenant'],
  ['task_checklist_items', 'tenant'],
  ['task_resources', 'tenant'],
  ['tax_components', 'tenant'],
  ['tax_regions', 'tenant'],
  ['tax_rates', 'tenant'],
  ['team_members', 'tenant'],
  ['telemetry_consent_log', 'tenant'],
  ['template_sections', 'tenant'],
  ['layout_blocks', 'tenant'],
  ['tenant_email_settings', 'tenant'],
  ['tenant_settings', 'tenant'],
  ['tenant_telemetry_settings', 'tenant'],
  ['ticket_bundle_settings', 'tenant'],
  ['ticket_entity_links', 'tenant'],
  ['ticket_resources', 'tenant'],
  ['time_period_types', 'tenant'],
  ['tenant_time_period_settings', 'tenant'],
  ['time_periods', 'tenant'],
  ['time_sheets', 'tenant'],
  ['time_entries', 'tenant'],
  ['invoice_time_entries', 'tenant'],
  ['time_sheet_comments', 'tenant'],
  ['usage_tracking', 'tenant'],
  ['invoice_usage_records', 'tenant'],
  ['user_auth_accounts', 'tenant'],
  ['user_internal_notification_preferences', 'tenant'],
  ['user_preferences', 'tenant'],
  ['user_roles', 'tenant'],
  ['user_type_rates', 'tenant'],
  ['workflow_form_definitions', 'tenant'],
  ['workflow_form_schemas', 'tenant'],
  ['workflow_step_usage_periods', 'tenant'],
  ['workflow_task_history', 'tenant'],
  ['workstation_assets', 'tenant'],
  // FK cycle members — the bundles->revisions edge is dropped above and
  // restored by FK_RECREATE after all four are distributed.
  ['authorization_bundles', 'tenant'],
  ['authorization_bundle_revisions', 'tenant'],
  ['authorization_bundle_rules', 'tenant'],
  ['authorization_bundle_assignments', 'tenant']
];

async function citusEnabled(knex) {
  const res = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled`);
  return Boolean(res.rows?.[0]?.enabled);
}

async function isInPgDistPartition(knex, table) {
  const res = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`, [table]);
  return Boolean(res.rows?.[0]?.present);
}

async function isReferenceTable(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'n') AS ok`, [table]);
  return Boolean(res.rows?.[0]?.ok);
}

async function pkColumns(knex, table) {
  const res = await knex.raw(
    `SELECT c.conname, array_agg(a.attname)::text[] AS cols
     FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = ?::regclass AND c.contype = 'p' GROUP BY c.oid, c.conname`, [table]);
  return res.rows?.[0] ?? null;
}

async function hasConstraint(knex, table, name) {
  const res = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?) AS ok`, [table, name]);
  return Boolean(res.rows?.[0]?.ok);
}

exports.up = async function up(knex) {
  const onCitus = await citusEnabled(knex);

  /* ---- 1. PK rebuilds (needed on Citus, applied everywhere for parity) ---- */
  for (const [table, newPk] of Object.entries(PK_REBUILDS)) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (onCitus && (await isInPgDistPartition(knex, table))) continue; // already converged
    const pk = await pkColumns(knex, table);
    if (pk && !pk.cols.includes('tenant')) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${pk.conname} CASCADE`);
      await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${pk.conname} PRIMARY KEY (${newPk})`);
      console.log(`  ✓ ${table} PK rebuilt as (${newPk})`);
    }
  }

  /* ---- 2. trigger drops (production-mirrored; Citus rejects triggers) ---- */
  if (onCitus) {
    for (const [table, triggers] of Object.entries(TRIGGER_DROPS)) {
      if (!(await knex.schema.hasTable(table))) continue;
      // Citus rejects DROP TRIGGER on an already-distributed table, even IF EXISTS.
      if (await isInPgDistPartition(knex, table)) continue;
      for (const trg of triggers) {
        await knex.raw(`DROP TRIGGER IF EXISTS ${trg} ON ${table}`);
      }
    }
  }

  /* ---- 2b. drop single-column uniques (superseded by composite PKs) ---- */
  // Some are unique constraints, some plain unique indexes — handle both.
  for (const [table, name] of UNIQUE_INDEX_DROPS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await hasConstraint(knex, table, name)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${name} CASCADE`);
    } else {
      await knex.raw(`DROP INDEX IF EXISTS ${name} CASCADE`);
    }
  }

  /* ---- 3. reference tables ---- */
  // Conversion order interacts with distribution (a still-local referrer with
  // an FK to a distributed table blocks conversion), so this runs before the
  // distribution loop and is retried once after it — whichever side of the
  // dependency converges first unblocks the other.
  const convertReferenceTables = async () => {
    for (const table of REFERENCE_TABLES) {
      if (!(await knex.schema.hasTable(table))) continue;
      if (await isReferenceTable(knex, table)) continue;
      if (await isInPgDistPartition(knex, table)) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
      }
      for (const [child, conname] of REFERENCE_INBOUND_FK_DROPS[table] ?? []) {
        await knex.raw(`ALTER TABLE ${child} DROP CONSTRAINT IF EXISTS ${conname}`);
      }
      const fks = await knex.raw(`SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'f'`, [table]);
      for (const fk of fks.rows) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
      }
      try {
        await knex.raw(`SELECT create_reference_table('${table}')`);
        console.log(`  ✓ ${table} -> reference table`);
      } catch (err) {
        console.warn(`  ! could not convert ${table} to reference: ${err.message}`);
      }
    }
  };
  if (onCitus) {
    await convertReferenceTables();
  }

  /* ---- 3b. swap composite SET NULL FKs to plain FKs, while local ---- */
  if (onCitus) {
    for (const [table, fks] of Object.entries(SET_NULL_FK_SWAPS)) {
      if (!(await knex.schema.hasTable(table))) continue;
      if (await isInPgDistPartition(knex, table)) continue;
      for (const [name, def] of fks) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
        try {
          await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${def}`);
        } catch (err) {
          console.warn(`  ! could not swap ${name}: ${err.message}`);
        }
      }
    }
    for (const [table, fkNames] of Object.entries(CYCLE_FK_DROPS)) {
      if (!(await knex.schema.hasTable(table))) continue;
      if (await isInPgDistPartition(knex, table)) continue;
      for (const name of fkNames) {
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`);
      }
    }
  }

  /* ---- 4. distribute, dependency-ordered (one retry after refs settle) ---- */
  const failed = [];
  for (const [table] of DISTRIBUTE_IN_ORDER) {
    if (!(await knex.schema.hasTable(table))) {
      console.log(`  - ${table} does not exist, skipping`);
      continue;
    }
    try {
      await ensureTenantDistribution(knex, table);
    } catch (err) {
      failed.push(table);
      console.warn(`  ! could not distribute ${table} (will retry): ${err.message}`);
    }
  }
  if (onCitus) {
    await convertReferenceTables(); // retry pass — referrers are distributed now
    for (const table of failed) {
      try {
        await ensureTenantDistribution(knex, table);
        console.log(`  ✓ ${table} distributed on retry`);
      } catch (err) {
        console.warn(`  ! could not distribute ${table}: ${err.message}`);
      }
    }
  }

  /* ---- 5. FK recreation (production shapes) ---- */
  for (const [table, fks] of Object.entries(FK_RECREATE)) {
    if (!(await knex.schema.hasTable(table))) continue;
    for (const [name, def] of fks) {
      if (await hasConstraint(knex, table, name)) continue;
      try {
        await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${def}`);
        console.log(`  ✓ added ${name}`);
      } catch (err) {
        console.warn(`  ! ${name} could not be added: ${err.message}`);
      }
    }
  }
};

exports.down = async function down(knex) {
  if (!(await citusEnabled(knex))) return;
  // Best-effort: undo distribution in reverse dependency order. PK shapes and
  // dropped triggers are not restored (they match production's schema).
  for (const [table] of DISTRIBUTE_IN_ORDER.slice().reverse()) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await isInPgDistPartition(knex, table)) {
      try { await knex.raw(`SELECT undistribute_table('${table}')`); }
      catch (err) { console.warn(`  ! could not undistribute ${table}: ${err.message}`); }
    }
  }
  for (const table of REFERENCE_TABLES.slice().reverse()) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await isReferenceTable(knex, table)) {
      try { await knex.raw(`SELECT undistribute_table('${table}')`); }
      catch (err) { console.warn(`  ! could not undistribute ${table}: ${err.message}`); }
    }
  }
};
