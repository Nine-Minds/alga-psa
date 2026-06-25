export type TenantTableScope =
  | { scope: 'tenant'; tenantColumn?: string }
  | { scope: 'global' }
  | { scope: 'admin' };

export interface ParsedTableExpression {
  tableExpression: string;
  tableName: string;
  rootAlias: string;
}

export const tenantTableMetadata: Record<string, TenantTableScope> = {
  assets: { scope: 'tenant' },
  apple_iap_subscriptions: { scope: 'tenant' },
  app_search_index: { scope: 'tenant' },
  api_keys: { scope: 'tenant' },
  clients: { scope: 'tenant' },
  authorization_bundle_assignments: { scope: 'tenant' },
  authorization_bundle_revisions: { scope: 'tenant' },
  authorization_bundle_rules: { scope: 'tenant' },
  authorization_bundles: { scope: 'tenant' },
  bucket_usage: { scope: 'tenant' },
  business_hours_entries: { scope: 'tenant' },
  business_hours_schedules: { scope: 'tenant' },
  calendar_providers: { scope: 'tenant' },
  client_billing_cycles: { scope: 'tenant' },
  client_billing_settings: { scope: 'tenant' },
  client_contracts: { scope: 'tenant' },
  client_contract_lines: { scope: 'tenant' },
  client_locations: { scope: 'tenant' },
  client_payment_customers: { scope: 'tenant' },
  client_tax_rates: { scope: 'tenant' },
  client_tax_settings: { scope: 'tenant' },
  categories: { scope: 'tenant' },
  chats: { scope: 'tenant' },
  comments: { scope: 'tenant' },
  comment_reactions: { scope: 'tenant' },
  contact_additional_email_addresses: { scope: 'tenant' },
  contact_email_type_definitions: { scope: 'tenant' },
  contact_phone_numbers: { scope: 'tenant' },
  contact_phone_type_definitions: { scope: 'tenant' },
  contacts: { scope: 'tenant' },
  comment_threads: { scope: 'tenant' },
  contracts: { scope: 'tenant' },
  contract_pricing_schedules: { scope: 'tenant' },
  contract_lines: { scope: 'tenant' },
  contract_line_service_bucket_config: { scope: 'tenant' },
  contract_line_service_configuration: { scope: 'tenant' },
  contract_line_service_defaults: { scope: 'tenant' },
  contract_line_service_fixed_config: { scope: 'tenant' },
  contract_line_service_hourly_config: { scope: 'tenant' },
  contract_line_service_hourly_configs: { scope: 'tenant' },
  contract_line_service_rate_tiers: { scope: 'tenant' },
  contract_line_service_usage_config: { scope: 'tenant' },
  contract_line_services: { scope: 'tenant' },
  contract_template_line_defaults: { scope: 'tenant' },
  contract_template_line_fixed_config: { scope: 'tenant' },
  contract_template_line_service_bucket_config: { scope: 'tenant' },
  contract_template_line_service_configuration: { scope: 'tenant' },
  contract_template_line_service_hourly_config: { scope: 'tenant' },
  contract_template_line_service_usage_config: { scope: 'tenant' },
  contract_template_line_services: { scope: 'tenant' },
  contract_template_line_terms: { scope: 'tenant' },
  contract_template_lines: { scope: 'tenant' },
  contract_template_pricing_schedules: { scope: 'tenant' },
  contract_templates: { scope: 'tenant' },
  credit_tracking: { scope: 'tenant' },
  custom_task_types: { scope: 'tenant' },
  default_billing_settings: { scope: 'tenant' },
  document_associations: { scope: 'tenant' },
  document_block_content: { scope: 'tenant' },
  document_content: { scope: 'tenant' },
  document_default_folders: { scope: 'tenant' },
  document_folders: { scope: 'tenant' },
  document_share_links: { scope: 'tenant' },
  document_types: { scope: 'tenant' },
  documents: { scope: 'tenant' },
  email_providers: { scope: 'tenant' },
  email_reply_tokens: { scope: 'tenant' },
  email_sending_logs: { scope: 'tenant' },
  entra_client_tenant_mappings: { scope: 'tenant' },
  entra_contact_links: { scope: 'tenant' },
  entra_contact_reconciliation_queue: { scope: 'tenant' },
  entra_sync_run_tenants: { scope: 'tenant' },
  escalation_managers: { scope: 'tenant' },
  external_files: { scope: 'tenant' },
  external_entity_mappings: { scope: 'tenant' },
  external_tax_imports: { scope: 'tenant' },
  holidays: { scope: 'tenant' },
  impacts: { scope: 'tenant' },
  import_jobs: { scope: 'tenant' },
  import_job_items: { scope: 'tenant' },
  invoice_charge_details: { scope: 'tenant' },
  invoice_charge_fixed_details: { scope: 'tenant' },
  invoice_charges: { scope: 'tenant' },
  invoice_template_assignments: { scope: 'tenant' },
  invoices: { scope: 'tenant' },
  internal_notifications: { scope: 'tenant' },
  interactions: { scope: 'tenant' },
  interaction_types: { scope: 'tenant' },
  job_details: { scope: 'tenant' },
  jobs: { scope: 'tenant' },
  kb_article_reviewers: { scope: 'tenant' },
  kb_article_templates: { scope: 'tenant' },
  kb_articles: { scope: 'tenant' },
  knex_migrations: { scope: 'global' },
  asset_associations: { scope: 'tenant' },
  asset_document_associations: { scope: 'tenant' },
  asset_facts: { scope: 'tenant' },
  asset_history: { scope: 'tenant' },
  asset_maintenance_history: { scope: 'tenant' },
  asset_maintenance_notifications: { scope: 'tenant' },
  asset_maintenance_schedules: { scope: 'tenant' },
  asset_relationships: { scope: 'tenant' },
  asset_service_history: { scope: 'tenant' },
  asset_software: { scope: 'tenant' },
  asset_ticket_associations: { scope: 'tenant' },
  boards: { scope: 'tenant' },
  client_portal_visibility_group_boards: { scope: 'tenant' },
  client_portal_visibility_groups: { scope: 'tenant' },
  inbound_ticket_defaults: { scope: 'tenant' },
  mobile_device_assets: { scope: 'tenant' },
  microsoft_profile_consumer_bindings: { scope: 'tenant' },
  microsoft_profiles: { scope: 'tenant' },
  mobile_push_tokens: { scope: 'tenant' },
  msp_sso_tenant_login_domains: { scope: 'tenant' },
  network_device_assets: { scope: 'tenant' },
  next_number: { scope: 'tenant' },
  notification_logs: { scope: 'tenant' },
  notification_settings: { scope: 'tenant' },
  password_reset_tokens: { scope: 'tenant' },
  permissions: { scope: 'tenant' },
  platform_notification_recipients: { scope: 'tenant' },
  policies: { scope: 'tenant' },
  portal_domain_session_otts: { scope: 'tenant' },
  portal_domains: { scope: 'tenant' },
  portal_invitations: { scope: 'tenant' },
  printer_assets: { scope: 'tenant' },
  priorities: { scope: 'tenant' },
  project_materials: { scope: 'tenant' },
  project_phases: { scope: 'tenant' },
  project_status_mappings: { scope: 'tenant' },
  project_templates: { scope: 'tenant' },
  project_template_checklist_items: { scope: 'tenant' },
  project_template_dependencies: { scope: 'tenant' },
  project_template_phases: { scope: 'tenant' },
  project_template_status_mappings: { scope: 'tenant' },
  project_template_task_resources: { scope: 'tenant' },
  project_template_tasks: { scope: 'tenant' },
  project_task_comment_reactions: { scope: 'tenant' },
  project_task_comments: { scope: 'tenant' },
  project_task_dependencies: { scope: 'tenant' },
  project_ticket_links: { scope: 'tenant' },
  projects: { scope: 'tenant' },
  project_tasks: { scope: 'tenant' },
  quote_activities: { scope: 'tenant' },
  quote_document_template_assignments: { scope: 'tenant' },
  quotes: { scope: 'tenant' },
  quote_items: { scope: 'tenant' },
  recurring_service_periods: { scope: 'tenant' },
  roles: { scope: 'tenant' },
  role_permissions: { scope: 'tenant' },
  rmm_alerts: { scope: 'tenant' },
  rmm_integrations: { scope: 'tenant' },
  rmm_organization_mappings: { scope: 'tenant' },
  schedule_entries: { scope: 'tenant' },
  schedule_entry_assignees: { scope: 'tenant' },
  server_assets: { scope: 'tenant' },
  service_categories: { scope: 'tenant' },
  service_catalog: { scope: 'tenant' },
  service_prices: { scope: 'tenant' },
  service_types: { scope: 'tenant' },
  severities: { scope: 'tenant' },
  sessions: { scope: 'tenant' },
  sla_audit_log: { scope: 'tenant' },
  sla_notification_thresholds: { scope: 'tenant' },
  sla_policies: { scope: 'tenant' },
  sla_policy_targets: { scope: 'tenant' },
  statuses: { scope: 'tenant' },
  stripe_customers: { scope: 'tenant' },
  stripe_prices: { scope: 'tenant' },
  stripe_products: { scope: 'tenant' },
  stripe_subscriptions: { scope: 'tenant' },
  stripe_webhook_events: { scope: 'tenant' },
  tax_components: { scope: 'tenant' },
  tax_rates: { scope: 'tenant' },
  tag_definitions: { scope: 'tenant' },
  tag_mappings: { scope: 'tenant' },
  task_checklist_items: { scope: 'tenant' },
  task_resources: { scope: 'tenant' },
  team_members: { scope: 'tenant' },
  teams: { scope: 'tenant' },
  teams_integrations: { scope: 'tenant' },
  tenants: { scope: 'tenant' },
  tenant_addons: { scope: 'tenant' },
  tenant_external_entity_mappings: { scope: 'tenant' },
  tenant_companies: { scope: 'tenant' },
  tenant_email_settings: { scope: 'tenant' },
  tenant_email_templates: { scope: 'tenant' },
  tenant_extension_install: { scope: 'tenant', tenantColumn: 'tenant_id' },
  tenant_extension_schedule: { scope: 'tenant', tenantColumn: 'tenant_id' },
  tenant_settings: { scope: 'tenant' },
  tenant_internal_notification_category_settings: { scope: 'tenant' },
  tenant_internal_notification_subtype_settings: { scope: 'tenant' },
  tenant_notification_category_settings: { scope: 'tenant' },
  tenant_notification_subtype_settings: { scope: 'tenant' },
  tenant_telemetry_settings: { scope: 'tenant' },
  telemetry_consent_log: { scope: 'tenant' },
  tickets: { scope: 'tenant' },
  ticket_auto_close_state: { scope: 'tenant' },
  ticket_bundle_mirrors: { scope: 'tenant' },
  ticket_bundle_settings: { scope: 'tenant' },
  ticket_entity_links: { scope: 'tenant' },
  ticket_resources: { scope: 'tenant' },
  time_entries: { scope: 'tenant' },
  time_periods: { scope: 'tenant' },
  time_sheets: { scope: 'tenant' },
  time_sheet_comments: { scope: 'tenant' },
  transactions: { scope: 'tenant' },
  urgencies: { scope: 'tenant' },
  user_activity_group_items: { scope: 'tenant' },
  user_activity_groups: { scope: 'tenant' },
  user_auth_accounts: { scope: 'tenant' },
  usage_tracking: { scope: 'tenant' },
  user_preferences: { scope: 'tenant' },
  user_internal_notification_preferences: { scope: 'tenant' },
  user_notification_preferences: { scope: 'tenant' },
  user_roles: { scope: 'tenant' },
  users: { scope: 'tenant' },
  workstation_assets: { scope: 'tenant' },
  workflow_runs: { scope: 'tenant' },
  workflow_tasks: { scope: 'tenant' },
};

function unquoteIdentifier(identifier: string): string {
  return identifier.replace(/^["'`\[]/, '').replace(/["'`\]]$/, '');
}

function baseTableName(tableName: string): string {
  const unquoted = unquoteIdentifier(tableName);
  const parts = unquoted.split('.');
  return unquoteIdentifier(parts[parts.length - 1]);
}

export function parseTableExpression(tableExpression: string): ParsedTableExpression {
  const trimmed = tableExpression.trim();
  if (!trimmed) {
    throw new Error('Tenant table expression cannot be empty');
  }

  const explicitAsAlias = trimmed.match(/^(.+?)\s+as\s+([^\s]+)$/i);
  if (explicitAsAlias) {
    const tableName = explicitAsAlias[1].trim();
    return {
      tableExpression: trimmed,
      tableName: baseTableName(tableName),
      rootAlias: unquoteIdentifier(explicitAsAlias[2]),
    };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const alias = parts[parts.length - 1];
    const tableName = parts.slice(0, -1).join(' ');
    return {
      tableExpression: trimmed,
      tableName: baseTableName(tableName),
      rootAlias: unquoteIdentifier(alias),
    };
  }

  return {
    tableExpression: trimmed,
    tableName: baseTableName(trimmed),
    rootAlias: baseTableName(trimmed),
  };
}

export function getTenantTableScope(tableName: string): TenantTableScope | undefined {
  return tenantTableMetadata[tableName];
}

export function requireTenantTableScope(tableName: string): TenantTableScope {
  const scope = getTenantTableScope(tableName);
  if (!scope) {
    throw new Error(`No tenant table metadata registered for ${tableName}`);
  }
  return scope;
}
