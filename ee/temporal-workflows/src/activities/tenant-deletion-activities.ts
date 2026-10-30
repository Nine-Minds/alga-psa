/**
 * Tenant Deletion Activities for Temporal Workflows
 * These activities handle the tenant deletion workflow including:
 * - User deactivation
 * - Client tagging in management tenant
 * - Statistics collection
 * - Deletion tracking
 * - Comprehensive tenant data deletion
 */

import { Context } from '@temporalio/activity';
import { Client, Connection } from '@temporalio/client';
import crypto from 'crypto';
import { getAdminConnection, refreshAdminConnection } from '@alga-psa/db/admin.js';
import { getTenantTableScope, retryOnReadOnly, tenantDb, type TenantTableScope } from '@alga-psa/db';
// Subpath import: the activity suites mock the '@alga-psa/db' barrel with a fixed export set.
import { tenantDeletionOrder } from '@alga-psa/db/tenantTableManifest';
import { TagModel } from '@alga-psa/shared/models/tagModel.js';
import { Knex } from 'knex';
import { getSecret } from '@alga-psa/core/secrets';
import type {
  TenantStats,
  DeactivateUsersResult,
  ReactivateUsersResult,
  TagClientResult,
  DeactivateMasterClientResult,
  ValidateTenantDeletionResult,
  RecordPendingDeletionInput,
  UpdateDeletionStatusInput,
  DeleteTenantDataResult,
  SendCancellationEmailResult,
  LinkSubscriptionToExistingTenantInput,
  LinkSubscriptionToExistingTenantResult,
  TriggerReactivationPasswordResetInput,
  RecordReactivationPaymentAlertInput,
} from '../types/tenant-deletion-types.js';
import { insertStripeSubscriptionForTenant } from '../db/tenant-operations.js';
import { updateSubscriptionMetadata } from '../services/stripe-service.js';

export {
  suspendTenantEmailIngestion,
  resumeTenantEmailIngestion,
  teardownTenantEmailIngestion,
} from './tenant-email-ingestion-activities.js';

export {
  suspendTenantBackgroundActivity,
  resumeTenantBackgroundActivity,
} from './tenant-suspension-activities.js';

/**
 * Comprehensive list of tables to delete from, in dependency order.
 * Most dependent tables first, then progressively less dependent.
 * This order is critical due to foreign key constraints.
 *
 * Synced from cli/cleanup-tenant.nu
 */
export const TENANT_TABLES_DELETION_ORDER: string[] = [
  'email_sender_routes',
  'email_sender_addresses',
  // rma_cases has a NO ACTION FK to asset_custody (rma_cases_custody_fk) plus FKs to clients/assets/
  // stock_units/tickets deleted later, so rma_events (FK to rma_cases) then rma_cases precede asset_custody.
  'rma_events',
  'rma_cases',
  'asset_custody_events',
  'asset_custody',
  'sessions',
  'staging_container_members',
  'staging_containers',
  'stock_movements',
  'stock_transfer_lines',
  'kit_components',
  'stock_levels',
  'product_inventory_settings',
  'count_lines',
  'vendor_bill_lines',
  'po_landed_costs',
  'purchase_order_lines',
  'sales_order_lines',
  'document_template_assignments',
  'vendor_products',
  'ghost_usage_reviews',
  'project_staging_lines',
  'stock_units',
  'count_sessions',
  'vendor_bills',
  'sales_orders',
  'stock_transfers',
  'purchase_orders',
  'document_templates',
  'stock_locations',
  'app_search_index',
  'workflow_task_history',
  'workflow_form_schemas',
  'workflow_run_steps',
  'workflow_run_waits',
  'workflow_run_snapshots',
  'workflow_action_invocations',
  'workflow_definition_versions',
  'workflow_run_logs',
  'workflow_event_launch_skips',
  'workflow_runtime_events',
  'workflow_step_usage_periods',
  'workflow_data_store',
  'workflow_entity_links',
  'date_trigger_emissions',
  'workflow_runs',
  'tenant_workflow_schedule',
  'workflow_definitions',
  'marketing_sequence_sends',
  'marketing_engagements',
  'social_post_targets',
  'social_posts',
  'marketing_sequence_enrollments',
  'marketing_sequence_steps',
  'marketing_sequences',
  'marketing_capture_forms',
  'marketing_content',
  'marketing_contact_state',
  'marketing_suppressions',
  'marketing_channels',
  'marketing_campaigns',
  'interactions',
  'interaction_types',
  'task_checklist_items',
  'project_task_dependencies',
  'task_resources',
  'project_ticket_links',
  'project_task_comment_reactions',
  'project_task_comments',
  'project_materials',
  'ticket_materials',
  'project_template_checklist_items',
  'project_template_dependencies',
  'project_template_task_resources',
  'project_template_status_mappings',
  'project_template_tasks',
  'project_template_phases',
  'project_templates',
  'quote_activities',
  'quote_items',
  'quote_document_template_assignments',
  'quote_document_templates',
  'standard_quote_document_templates',
  'quotes',
  'opportunity_meeting_reviews',
  'opportunity_commitments',
  'opportunity_steps',
  'opportunity_step_templates',
  'opportunity_evidence',
  'opportunity_qbr_triggers',
  'opportunity_suggestions',
  'opportunity_meeting_sessions',
  'opportunity_settings',
  'opportunities',
  'invoice_adjustment_operations',
  'invoice_charges',
  'invoice_annotations',
  'invoice_time_entries',
  'invoice_usage_records',
  'invoice_charge_details',
  'invoice_charge_fixed_details',
  'invoice_items',
  'invoice_autopay_attempts',
  'billing_profile_autopay',
  'invoice_payment_links',
  'invoice_payments',
  'payment_confirmation_emails',
  'invoice_template_assignments',
  'hour_block_audit',
  'hour_block_service_scopes',
  'hour_block_time_allocations',
  'hour_blocks',
  'contract_line_block_issuances',
  'time_tracking_session_segments',
  'time_tracking_sessions',
  'time_entry_suggestion_dismissals',
  'time_sheet_comments',
  'time_entry_change_requests',
  'time_entries',
  'time_sheets',
  'user_cost_rates',
  'document_block_content',
  'document_versions',
  'document_content',
  'document_folders',
  'document_system_entries',
  'ticket_bundle_mirrors',
  'ticket_comment_attachment_challenges',
  'ticket_comment_attachments',
  'ticket_comment_email_deliveries',
  'comment_reactions',
  'vectors',
  'email_reply_tokens',
  'comments',
  'comment_threads',
  'gmail_processed_history',
  'email_processed_attachments',
  'email_processed_messages',
  'email_sending_logs',
  'email_rate_limits',
  'msp_sso_domain_verification_challenges',
  'msp_sso_tenant_login_domains',
  'microsoft_profile_consumer_bindings',
  'teams_notification_deliveries',
  'teams_audit_events',
  'teams_conversation_references',
  'teams_integrations',
  'microsoft_profiles',
  'telephony_call_artifacts',
  'telephony_call_intents',
  'telephony_call_records',
  'telephony_chat_records',
  'telephony_providers',
  'authorization_bundle_assignments',
  'authorization_bundle_rules',
  'authorization_bundle_revisions',
  'authorization_bundles',
  'scim_operations',
  'scim_unresolved_identities',
  'scim_user_links',
  'scim_connections',
  'user_activity_group_items',
  'user_activity_groups',
  'user_notification_preferences',
  'user_internal_notification_preferences',
  'user_preferences',
  'role_permissions',
  'user_roles',
  'user_auth_accounts',
  'mobile_push_tokens',
  'content_reports',
  'user_content_mutes',
  'apple_iap_subscriptions',
  'apple_iap_notifications',
  'apple_user_identities',
  'schedule_entry_assignees',
  'schedule_conflicts',
  'team_members',
  'availability_exceptions',
  'availability_settings',
  'calendar_event_mappings',
  'calendar_provider_health',
  'google_calendar_provider_config',
  'microsoft_calendar_provider_config',
  'calendar_providers',
  'tag_mappings',
  'tag_references',
  'tag_display_rules',
  'ticket_resources',
  'ticket_watchers',
  'document_fetch_hosts',
  'client_portal_visibility_group_boards',
  'import_job_items',
  'import_jobs',
  'migration_record_outcomes',
  'migration_staged_records',
  'migration_job_entities',
  'migration_identity_mappings',
  'migration_reports',
  'migration_mapping_profiles',
  'migration_jobs',
  'job_details',
  'jobs',
  'audit_logs',
  'notification_logs',
  'internal_notifications',
  'platform_notification_recipients',
  'extension_execution_log',
  'extension_execution_log_old',
  'extension_quota_usage',
  'extension_quota_usage_old',
  'extension_audit_logs',
  'extension_event_subscription',
  'extension_settings',
  'extension_storage',
  'messages',
  'chats',
  'custom_reports',
  'inbound_webhook_deliveries',
  'inbound_webhooks',
  'external_entity_mappings',
  'import_sources',
  'recurring_ticket_client_assets',
  'recurring_ticket_occurrences',
  'recurring_ticket_definition_clients',
  'recurring_ticket_definitions',
  'ticket_template_checklist_items',
  'ticket_templates',
  'canned_response_favorites',
  'canned_responses',
  'asset_remote_access_links',
  'asset_maintenance_occurrences',
  'asset_maintenance_notifications',
  'asset_maintenance_history',
  'asset_service_history',
  'asset_ticket_associations',
  'asset_document_associations',
  'asset_relationships',
  'asset_history',
  'asset_associations',
  'asset_software',
  'asset_facts',
  'workstation_assets',
  'server_assets',
  'network_device_assets',
  'mobile_device_assets',
  'printer_assets',
  'asset_type_registry',
  'asset_statuses',
  'asset_assignments',
  'asset_group_members',
  'asset_group_contacts',
  'asset_groups',
  'software_catalog',
  'rmm_webhook_events',
  'rmm_maintenance_windows',
  'rmm_alert_rules',
  'rmm_alerts',
  'rmm_organization_mappings',
  'rmm_integrations',
  'survey_responses',
  'survey_invitations',
  'survey_triggers',
  'survey_templates',
  'online_meeting_artifacts',
  'online_meetings',
  'appointment_requests',
  'external_entity_links',
  'tenant_external_systems',
  'list_views',
  'sla_notifications_sent',
  'sla_audit_log',
  'ticket_audit_logs',
  'sla_notification_thresholds',
  'sla_policy_targets',
  'status_sla_pause_config',
  'business_hours_entries',
  'holidays',
  'escalation_managers',
  'sla_settings',
  'stripe_webhook_events',
  'stripe_subscriptions',
  'stripe_prices',
  'stripe_products',
  'stripe_customers',
  'stripe_accounts',
  'payment_webhook_events',
  'payment_provider_configs',
  'client_payment_customers',
  'tenant_reactivation_tokens',
  'pending_reactivation_refunds',
  'prepaid_balance_alert_deliveries',
  'prepaid_balance_alerts',
  'credit_allocations',
  'credit_tracking',
  'usage_period_total_requests',
  'usage_period_totals',
  'usage_measurement_revisions',
  'contract_line_unit_pricing_revision_history',
  'contract_recurring_unit_adjustments',
  'contract_line_unit_pricing_revisions',
  'billing_semantics_locks',
  'usage_tracking',
  'bucket_usage',
  'bucket_usage_unmappable_archive',
  'recurring_service_periods',
  'transactions',
  'accounting_export_artifacts',
  'accounting_export_errors',
  'accounting_export_lines',
  'accounting_export_batches',
  'accounting_sync_operations',
  'accounting_sync_cycles',
  'contract_line_bucket_services',
  'contract_line_buckets',
  'contract_template_discount_copies',
  'client_contracts',
  'contract_line_service_rate_tiers',
  'contract_line_service_bucket_config',
  'contract_line_service_hourly_config',
  'contract_line_service_hourly_configs',
  'contract_line_service_usage_config',
  'contract_line_service_fixed_config',
  'contract_line_service_configuration',
  'contract_line_service_defaults',
  'contract_pricing_schedules',
  'service_catalog_mode_defaults',
  'service_rate_tiers',
  'service_prices',
  'contract_line_discounts',
  'contract_discount_assignments',
  'discounts',
  'client_billing_cycles',
  'client_billing_settings',
  'contract_line_prepaid_blocks',
  'contract_line_services',
  'contract_lines',
  'contracts',
  'contract_line_preset_prepaid_blocks',
  'contract_line_preset_fixed_config',
  'contract_line_preset_services',
  'contract_line_presets',
  'contract_template_prices',
  'contract_template_price_sets',
  'contract_template_line_defaults',
  'contract_template_line_prepaid_blocks',
  'contract_template_line_bucket_services',
  'contract_template_line_buckets',
  'contract_template_line_fixed_config',
  'contract_template_line_service_bucket_config',
  'contract_template_line_service_fixed_config',
  'contract_template_line_service_hourly_config',
  'contract_template_line_service_usage_config',
  'contract_template_line_service_configuration',
  'contract_template_line_services',
  'contract_template_line_terms',
  'contract_template_lines',
  'contract_template_pricing_schedules',
  'contract_template_services',
  'contract_templates',
  'client_tax_rates',
  'client_tax_settings',
  'client_inbound_email_domains',
  'client_name_aliases',
  'tenant_companies',
  'entra_contact_reconciliation_queue',
  'entra_contact_links',
  'entra_managed_tenant_user_filters',
  'entra_client_tenant_mappings',
  'entra_sync_run_tenants',
  'entra_sync_runs',
  'entra_managed_tenants',
  'entra_partner_connections',
  'entra_sync_settings',
  'hudu_integrations',
  'provider_disconnect_records',
  'project_billing_schedule_entries',
  'project_billing_cap_usage',
  'project_billing_configs',
  'project_phase_rate_overrides',
  'project_tasks',
  'project_phases',
  'project_status_mappings',
  'projects',
  'workflow_tasks',
  'workflow_form_definitions',
  'workflow_task_definitions',

  // Service request runtime and published snapshots
  // Applications restrict deletion of mapping versions; remove their results first.
  'service_request_submission_application_results', 'service_request_submission_applications',
  'service_request_answer_mapping_versions', 'service_request_answer_mappings',
  'service_request_submission_attachments', 'service_request_submissions',
  'service_request_definition_versions', 'service_request_definitions',
  'co_management_board_scopes',
  'co_managed_allocations',
  'co_managed_entitlements',
  'co_managed_provisioning_operations',
  'co_managed_purchase_operations',
  'tenant_license_state',
  'co_managed_meeting_creation_operations',
  'co_management_relationship_events',
  'co_management_delegated_receipts',
  'co_management_delegated_grants',
  'co_management_project_scopes',
  'co_management_staff_assignments',
  'co_managed_project_task_references',
  'collaboration_actor_references',
  'co_managed_participation_evidence',
  // Handoffs FK to ticket work, which FKs to relationships: children first. References and
  // receipts reference the client/board/relationship rows deleted later.
  'co_management_ticket_handoffs',
  'co_management_ticket_work',
  'co_managed_ticket_references',
  'co_management_command_receipts',
  'co_management_relationships',

  // === LEVEL 3: Mid-level entities ===
  // Document-related leaf tables (must come before documents)
  'document_share_access_log', 'document_share_links',
  // KB import staging rows: a leaf (article_id / job_id are soft refs, no FK), so
  // it only has to precede tenants. Kept next to kb_articles for readability.
  'kb_import_files',
  'kb_article_relations',
  'kb_article_reviewers',
  'kb_article_templates',
  'kb_articles',
  'document_default_folders',
  'document_folder_template_items',
  'document_entity_folder_init',
  'document_folder_templates',
  'document_associations',
  'credential_associations',
  'credential_access_grants',
  'credentials',
  'asset_maintenance_schedules',
  'assets',
  'vendors',
  'payment_methods',
  'schedule_entries',
  'calendar_shares',
  'calendars',
  'service_catalog',
  'service_types',
  'service_categories',
  'tenant_units_of_measure',
  'approval_thresholds',
  'conditional_display_rules',
  'layout_blocks',
  'template_sections',
  'invoice_templates',
  'invoices',
  'file_upload_session_files',
  'file_upload_sessions',
  'external_files',
  'documents',
  'document_types',
  'ticket_auto_close_state',
  'board_auto_close_rules',
  'ticket_checklist_items',
  'checklist_template_apply_rules',
  'checklist_template_items',
  'checklist_templates',
  'board_close_rules',
  'board_notification_rule_recipients',
  'board_notification_rule_statuses',
  'board_notification_rules',
  'board_default_watchers',
  'ticket_bundle_settings',
  'ticket_entity_links',
  'ticket_bundle_status_propagations',
  'tickets',
  'client_locations',
  'categories',
  'boards',
  'statuses',
  'priorities',
  'severities',
  'urgencies',
  'impacts',
  'tax_components',
  'permissions',
  'roles',
  'teams',
  'tenant_secrets_audit_log',
  'tenant_secrets',
  'contact_phone_numbers',
  'contact_additional_email_addresses',
  'contact_phone_type_definitions',
  'client_portal_visibility_groups',
  'portal_invitations',
  'user_invitations',
  'client_portal_user_billing_profiles',
  'billing_profile_contacts',
  'client_billing_profiles',
  'client_merges',
  'client_tax_id_migration_conflicts',
  'clients',
  'contacts',
  'contact_email_type_definitions',
  'password_reset_tokens',
  'resources',
  'user_work_schedules',
  'tenant_telemetry_settings',
  'agent_roles',
  'mcp_agent_audit',
  'agent_idp_providers',
  'agents',
  'mcp_oauth_auth_codes',
  'mcp_oauth_refresh_tokens',
  'mcp_oauth_grants',
  'users',
  'sla_policies',
  'business_hours_schedules',
  // Webhook receipts and deliveries must be deleted before webhooks.
  'webhook_event_receipts',
  'webhook_deliveries',
  'webhooks',
  'api_rate_limit_settings',
  'mobile_auth_otts',
  'mobile_refresh_tokens',
  'api_keys',
  'portal_domain_session_otts',
  'portal_domains',
  'policies',
  'google_email_provider_config',
  'microsoft_email_provider_config',
  'imap_email_provider_config',
  'email_provider_health',
  'email_provider_configs',
  'email_providers',
  'email_templates',
  'email_domains',
  'tenant_email_settings',
  'storage_records',
  'storage_schemas',
  'storage_usage',
  'storage_configurations',
  'provider_events',
  'storage_providers',
  'ext_storage_records',
  'ext_storage_schemas',
  'ext_storage_usage',
  'tenant_email_templates',
  'approval_levels',
  'attribute_definitions',
  'custom_fields',
  'tag_definitions',
  'custom_task_types',
  'tenant_time_period_settings',
  'time_period_calendar_locks',
  'time_periods',
  'time_period_types',
  'time_period_settings',
  'external_tax_imports',
  'tenant_internal_notification_category_settings',
  'tenant_internal_notification_subtype_settings',
  'tenant_notification_category_settings',
  'tenant_notification_subtype_settings',
  'tenant_external_entity_mappings',
  'telemetry_consent_log',
  'default_billing_settings',
  'notification_settings',
  'inbound_email_rules',
  'inbound_ticket_defaults',
  'user_type_rates',
  'next_number',
  'event_catalog',
  'inbound_email_event_deliveries',
  'inbound_email_effects',
  'inbound_email_artifacts',
  'inbound_email_outbox',
  'inbound_email_inbox',
  'inbound_email_ingress',
  'tenant_extension_schedule',
  'tenant_extension_install_secrets',
  'tenant_extension_install_config',
  'tenant_extension_install',
  'extensions',
  'tenant_addons',
  'tenant_settings',
  'tax_rates',
  'tax_regions',
];

// The manifest (packages/db tenantTableManifest) owns membership and order; the array above is its
// golden projection, asserted element-for-element by tenantTableManifest.golden.test.ts.
const TENANT_TABLES_DELETION_SET = new Set(tenantDeletionOrder());
const MANAGEMENT_TENANT_DISCOVERY_CONTEXT = '__tenant_deletion_management_tenant_discovery__';

type TenantColumnName = 'tenant' | 'tenant_id';

interface TenantDeletionTableBoundary {
  tableName: string;
  tenantColumn: TenantColumnName;
  metadataScope: TenantTableScope | undefined;
  reason: string;
}

const logger = () => Context.current().log;

/**
 * Get the management tenant ID for 'Nine Minds LLC'
 */
async function getManagementTenantIdInternal(knex: Knex): Promise<string | null> {
  const MANAGEMENT_TENANT_NAME = 'Nine Minds LLC';

  const tenant = await tenantDb(knex, MANAGEMENT_TENANT_DISCOVERY_CONTEXT)
    .unscoped('tenants', 'tenant deletion must discover the management tenant before tenant context is known')
    .where('client_name', MANAGEMENT_TENANT_NAME)
    .first();

  return tenant?.tenant || null;
}

/**
 * Find the customer client in the management tenant that represents a given tenant.
 * Tries multiple lookup strategies:
 * 1. By tenant_id property in client properties (UUID)
 * 2. By exact client name matching tenant name
 * 3. By finding a contact with the tenant admin's email
 */
async function findCustomerClientInManagementTenant(
  knex: Knex,
  tenantId: string,
  managementTenantId: string,
  log: ReturnType<typeof logger>
): Promise<{ client_id: string; client_name: string } | null> {
  type ClientLookupRow = { client_id: string; client_name: string };
  type ContactLookupRow = { client_id: string | null; email: string | null };
  type UserLookupRow = { user_id: string; email: string | null };

  const tenantScopedDb = tenantDb(knex, tenantId);
  const managementDb = tenantDb(knex, managementTenantId);

  // Strategy 1: Look for client with tenant_id in properties matching the tenantId
  let customerClient = await managementDb.table<ClientLookupRow>('clients')
    .select('client_id', 'client_name')
    .whereRaw("properties->>'tenant_id' = ?", [tenantId])
    .first();

  if (customerClient) {
    log.info('Found customer client by tenant_id property', {
      clientId: customerClient.client_id,
      clientName: customerClient.client_name,
    });
    return customerClient;
  }

  // Strategy 2: Look for client by exact name match
  const tenant = await tenantScopedDb.table('tenants').first();
  if (tenant) {
    customerClient = await managementDb.table<ClientLookupRow>('clients')
      .select('client_id', 'client_name')
      .where({ client_name: tenant.client_name })
      .first();

    if (customerClient) {
      log.info('Found customer client by name match', {
        clientId: customerClient.client_id,
        clientName: customerClient.client_name,
      });
      return customerClient;
    }
  }

  // Strategy 3: Find by tenant admin user's email
  // Get the admin user's email from the tenant being deleted
  const adminUserIds = tenantScopedDb.table('user_roles')
    .select('user_id')
    .whereIn('role_id', tenantScopedDb.table('roles')
      .select('role_id')
      .where({ role_name: 'Admin' }));
  const adminUser = await tenantScopedDb.table<UserLookupRow>('users')
    .select('email')
    .whereIn('user_id', adminUserIds)
    .first();

  if (adminUser?.email) {
    log.info('Trying email-based lookup', { email: adminUser.email });

    // Find a contact in the management tenant with this email
    const contact = await managementDb.table<ContactLookupRow>('contacts')
      .select('client_id')
      .where({ email: adminUser.email })
      .whereNotNull('client_id')
      .first();

    if (contact?.client_id) {
      customerClient = await managementDb.table<ClientLookupRow>('clients')
        .select('client_id', 'client_name')
        .where({ client_id: contact.client_id })
        .first();

      if (customerClient) {
        log.info('Found customer client by admin email', {
          clientId: customerClient.client_id,
          clientName: customerClient.client_name,
          email: adminUser.email,
        });
        return customerClient;
      }
    }
  }

  // Strategy 4: Try any user email from the tenant (fallback)
  const anyUser = await tenantScopedDb.table<UserLookupRow>('users')
    .select('email')
    .whereNotNull('email')
    .first();

  if (anyUser?.email) {
    log.info('Trying email-based lookup with any user', { email: anyUser.email });

    const contact = await managementDb.table<ContactLookupRow>('contacts')
      .select('client_id')
      .where({ email: anyUser.email })
      .whereNotNull('client_id')
      .first();

    if (contact?.client_id) {
      customerClient = await managementDb.table<ClientLookupRow>('clients')
        .select('client_id', 'client_name')
        .where({ client_id: contact.client_id })
        .first();

      if (customerClient) {
        log.info('Found customer client by user email', {
          clientId: customerClient.client_id,
          clientName: customerClient.client_name,
          email: anyUser.email,
        });
        return customerClient;
      }
    }
  }

  log.warn('No customer client found for tenant in management tenant', {
    tenantId,
    tenantName: tenant?.client_name,
  });
  return null;
}

/**
 * Validate that a tenant can be deleted.
 * CRITICAL SAFEGUARD: Prevents deletion of master/management tenant.
 */
export async function validateTenantDeletion(
  tenantId: string
): Promise<ValidateTenantDeletionResult> {
  const log = logger();
  log.info('Validating tenant deletion', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    // Get the management tenant ID
    const managementTenantId = await getManagementTenantIdInternal(adminKnex);

    // Check if tenant exists
    const tenant = await tenantDb(adminKnex, tenantId).table('tenants').first();
    const tenantExists = !!tenant;

    // CRITICAL: Check if this is the management tenant
    const isMasterTenant = tenantId === managementTenantId;

    if (isMasterTenant) {
      log.error('BLOCKED: Attempted to delete master/management tenant', {
        tenantId,
        managementTenantId,
        tenantName: tenant?.client_name,
      });
      return {
        valid: false,
        tenantExists,
        isMasterTenant: true,
        managementTenantId,
        error: 'Cannot delete master/management tenant. This operation is blocked for safety.',
      };
    }

    if (!tenantExists) {
      log.warn('Tenant does not exist', { tenantId });
      return {
        valid: false,
        tenantExists: false,
        isMasterTenant: false,
        managementTenantId,
        error: 'Tenant does not exist',
      };
    }

    log.info('Tenant deletion validation passed', {
      tenantId,
      tenantName: tenant.client_name,
      managementTenantId,
    });

    return {
      valid: true,
      tenantExists: true,
      isMasterTenant: false,
      managementTenantId,
    };
  } catch (error) {
    log.error('Failed to validate tenant deletion', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    throw error;
  }
}

/**
 * Deactivate all users for a tenant
 * Sets is_inactive = true for all active users
 */
export async function deactivateAllTenantUsers(
  tenantId: string
): Promise<DeactivateUsersResult> {
  const log = logger();
  log.info('Deactivating all users for tenant', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const result = await tenantDb(adminKnex, tenantId).table('users')
      .where({ is_inactive: false })
      .update({ is_inactive: true, updated_at: adminKnex.fn.now() });

    log.info('Users deactivated successfully', { tenantId, deactivatedCount: result });
    return { deactivatedCount: result };
  } catch (error) {
    log.error('Failed to deactivate users', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    throw error;
  }
}

/**
 * Reactivate all users for a tenant (for rollback)
 * Sets is_inactive = false for all inactive users
 */
export async function reactivateTenantUsers(
  tenantId: string
): Promise<ReactivateUsersResult> {
  const log = logger();
  log.info('Reactivating users for tenant', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const result = await tenantDb(adminKnex, tenantId).table('users')
      .where({ is_inactive: true })
      .update({ is_inactive: false, updated_at: adminKnex.fn.now() });

    log.info('Users reactivated successfully', { tenantId, reactivatedCount: result });
    return { reactivatedCount: result };
  } catch (error) {
    log.error('Failed to reactivate users', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    throw error;
  }
}

/**
 * Tag the tenant's client as 'Canceled' in the management tenant
 */
export async function tagClientAsCanceled(
  tenantId: string
): Promise<TagClientResult> {
  const log = logger();
  log.info('Tagging client as Canceled', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    // Get the management tenant ID
    const managementTenantId = await getManagementTenantIdInternal(adminKnex);
    if (!managementTenantId) {
      log.warn('Management tenant not found, skipping tag creation', { tenantId });
      return {};
    }

    // Find the customer client using the unified lookup function
    const customerClient = await findCustomerClientInManagementTenant(
      adminKnex,
      tenantId,
      managementTenantId,
      log
    );

    if (!customerClient) {
      return {};
    }

    // Create the 'Canceled' tag
    const tagResult = await adminKnex.transaction(async (trx) => {
      return await TagModel.createTag(
        {
          tag_text: 'Canceled',
          tagged_id: customerClient.client_id,
          tagged_type: 'client',
          created_by: 'system',
        },
        managementTenantId,
        trx
      );
    });

    log.info('Client tagged as Canceled', {
      tenantId,
      clientId: customerClient.client_id,
      tagId: tagResult.tag_id,
    });

    return { tagId: tagResult.tag_id };
  } catch (error) {
    log.error('Failed to tag client as Canceled', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    // Don't throw - tagging failure shouldn't block deletion workflow
    return {};
  }
}

/**
 * Remove 'Canceled' tag from client (for rollback)
 */
export async function removeClientCanceledTag(tenantId: string): Promise<void> {
  const log = logger();
  log.info('Removing Canceled tag from client', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const managementTenantId = await getManagementTenantIdInternal(adminKnex);
    if (!managementTenantId) {
      log.warn('Management tenant not found, skipping tag removal');
      return;
    }

    // Find customer client using the unified lookup function
    const customerClient = await findCustomerClientInManagementTenant(
      adminKnex,
      tenantId,
      managementTenantId,
      log
    );

    if (!customerClient) {
      return;
    }

    // Remove the 'Canceled' tag mapping
    const managementDb = tenantDb(adminKnex, managementTenantId);
    await managementDb.table('tag_mappings')
      .where({ tagged_id: customerClient.client_id })
      .whereIn(
        'tag_id',
        managementDb.table('tag_definitions')
          .select('tag_id')
          .where({ tag_text: 'Canceled' })
      )
      .del();

    log.info('Canceled tag removed from client', {
      tenantId,
      clientId: customerClient.client_id,
    });
  } catch (error) {
    log.error('Failed to remove Canceled tag', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    // Don't throw - tag removal failure shouldn't block rollback
  }
}

/**
 * Flip is_inactive on the client-portal users linked to a management-tenant
 * client's contacts. Contact ids are selected first (Citus: no subquery UPDATE).
 */
async function setMasterClientPortalUsersInactive(
  knex: Knex,
  managementTenantId: string,
  clientId: string,
  inactive: boolean
): Promise<number> {
  const managementDb = tenantDb(knex, managementTenantId);

  const contacts = await managementDb.table('contacts')
    .where({ client_id: clientId })
    .select('contact_name_id');
  const contactIds = (contacts as Array<{ contact_name_id: string }>)
    .map((contact) => contact.contact_name_id);
  if (contactIds.length === 0) {
    return 0;
  }

  return await managementDb.table('users')
    .whereIn('contact_id', contactIds)
    .andWhere({ user_type: 'client', is_inactive: !inactive })
    .update({ is_inactive: inactive, updated_at: knex.fn.now() });
}

/**
 * Deactivate the client, its contacts and their portal users in the management
 * tenant. This is called when a tenant is marked for deletion to disable their
 * customer record in Nine Minds' CRM.
 */
export async function deactivateMasterTenantClient(
  tenantId: string
): Promise<DeactivateMasterClientResult> {
  const log = logger();
  log.info('Deactivating client and contacts in master tenant', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    // Get the management tenant ID
    const managementTenantId = await getManagementTenantIdInternal(adminKnex);
    if (!managementTenantId) {
      log.warn('Management tenant not found, skipping client deactivation', { tenantId });
      return { clientDeactivated: false, contactsDeactivated: 0 };
    }

    // Find the customer client using the unified lookup function
    const customerClient = await findCustomerClientInManagementTenant(
      adminKnex,
      tenantId,
      managementTenantId,
      log
    );

    if (!customerClient) {
      return { clientDeactivated: false, contactsDeactivated: 0 };
    }

    const clientId = customerClient.client_id;

    // Deactivate the client
    const managementDb = tenantDb(adminKnex, managementTenantId);

    await managementDb.table('clients')
      .where({ client_id: clientId })
      .update({ is_inactive: true, updated_at: adminKnex.fn.now() });

    log.info('Deactivated client in master tenant', {
      tenantId,
      clientId,
      clientName: customerClient.client_name,
    });

    // Deactivate all contacts for this client
    const contactsUpdated = await managementDb.table('contacts')
      .where({ client_id: clientId })
      .update({ is_inactive: true, updated_at: adminKnex.fn.now() });

    log.info('Deactivated contacts for client in master tenant', {
      tenantId,
      clientId,
      contactsDeactivated: contactsUpdated,
    });

    // Deactivate the contacts' support-portal users so the email is free for a later signup
    const portalUsersUpdated = await setMasterClientPortalUsersInactive(
      adminKnex,
      managementTenantId,
      clientId,
      true
    );

    log.info('Deactivated portal users for client in master tenant', {
      tenantId,
      clientId,
      portalUsersDeactivated: portalUsersUpdated,
    });

    return {
      clientId,
      clientDeactivated: true,
      contactsDeactivated: contactsUpdated,
      portalUsersDeactivated: portalUsersUpdated,
    };
  } catch (error) {
    log.error('Failed to deactivate client in master tenant', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    // Don't throw - client deactivation failure shouldn't block deletion workflow
    return { clientDeactivated: false, contactsDeactivated: 0 };
  }
}

/**
 * Reactivate the client and its contacts in the management tenant (for rollback).
 */
export async function reactivateMasterTenantClient(tenantId: string): Promise<void> {
  const log = logger();
  log.info('Reactivating client and contacts in master tenant', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const managementTenantId = await getManagementTenantIdInternal(adminKnex);
    if (!managementTenantId) {
      log.warn('Management tenant not found, skipping client reactivation');
      return;
    }

    // Find customer client using the unified lookup function
    const customerClient = await findCustomerClientInManagementTenant(
      adminKnex,
      tenantId,
      managementTenantId,
      log
    );

    if (!customerClient) {
      return;
    }

    const clientId = customerClient.client_id;

    // Reactivate the client
    const managementDb = tenantDb(adminKnex, managementTenantId);

    await managementDb.table('clients')
      .where({ client_id: clientId })
      .update({ is_inactive: false, updated_at: adminKnex.fn.now() });

    // Reactivate contacts
    await managementDb.table('contacts')
      .where({ client_id: clientId })
      .update({ is_inactive: false, updated_at: adminKnex.fn.now() });

    await setMasterClientPortalUsersInactive(adminKnex, managementTenantId, clientId, false);

    log.info('Reactivated client and contacts in master tenant', {
      tenantId,
      clientId,
    });
  } catch (error) {
    log.error('Failed to reactivate client in master tenant', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    // Don't throw - reactivation failure shouldn't block rollback
  }
}

/**
 * Collect tenant statistics for audit purposes
 */
export async function collectTenantStats(tenantId: string): Promise<TenantStats> {
  const log = logger();
  log.info('Collecting tenant statistics', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const tenantScopedDb = tenantDb(adminKnex, tenantId);

    // Get all counts in parallel for efficiency
    const [
      userCountResult,
      activeUserCountResult,
      ticketCountResult,
      openTicketCountResult,
      invoiceCountResult,
      projectCountResult,
      documentCountResult,
      clientCountResult,
      contactCountResult,
      tenantInfo,
    ] = await Promise.all([
      tenantScopedDb.table('users').count('* as count').first(),
      tenantScopedDb.table('users').where({ is_inactive: false }).count('* as count').first(),
      tenantScopedDb.table('tickets').count('* as count').first().catch(() => ({ count: 0 })),
      // Open tickets - exclude closed status
      tenantScopedDb.table('tickets')
        .whereNotIn(
          'status_id',
          tenantScopedDb.table('statuses')
            .select('status_id')
            .where({ is_closed: true })
        )
        .count('* as count')
        .first()
        .catch(() => ({ count: 0 })),
      tenantScopedDb.table('invoices').count('* as count').first().catch(() => ({ count: 0 })),
      tenantScopedDb.table('projects').count('* as count').first().catch(() => ({ count: 0 })),
      tenantScopedDb.table('documents').count('* as count').first().catch(() => ({ count: 0 })),
      tenantScopedDb.table('clients').count('* as count').first().catch(() => ({ count: 0 })),
      tenantScopedDb.table('contacts').count('* as count').first().catch(() => ({ count: 0 })),
      tenantScopedDb.table('tenants').select('licensed_user_count').first(),
    ]);

    const stats: TenantStats = {
      userCount: Number(userCountResult?.count || 0),
      activeUserCount: Number(activeUserCountResult?.count || 0),
      licenseCount: tenantInfo?.licensed_user_count || 0,
      ticketCount: Number(ticketCountResult?.count || 0),
      openTicketCount: Number(openTicketCountResult?.count || 0),
      invoiceCount: Number(invoiceCountResult?.count || 0),
      projectCount: Number(projectCountResult?.count || 0),
      documentCount: Number(documentCountResult?.count || 0),
      clientCount: Number(clientCountResult?.count || 0),
      contactCount: Number(contactCountResult?.count || 0),
      collectedAt: new Date().toISOString(),
    };

    log.info('Tenant statistics collected', { tenantId, stats });
    return stats;
  } catch (error) {
    log.error('Failed to collect tenant statistics', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    throw error;
  }
}

/**
 * Get the tenant name for display purposes
 */
export async function getTenantName(tenantId: string): Promise<string> {
  const log = logger();

  try {
    const adminKnex = await getAdminConnection();
    const tenant = await tenantDb(adminKnex, tenantId).table('tenants').first();
    return tenant?.client_name || tenantId;
  } catch (error) {
    log.error('Failed to get tenant name', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
    });
    return tenantId;
  }
}

/**
 * Record a pending tenant deletion in the database
 */
export async function recordPendingDeletion(
  data: RecordPendingDeletionInput
): Promise<void> {
  const log = logger();
  log.info('Recording pending tenant deletion', { deletionId: data.deletionId, tenantId: data.tenantId });

  try {
    const adminKnex = await getAdminConnection();

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + 90);

    // Build stats snapshot with export info
    const statsSnapshot = {
      ...data.stats,
      export: data.exportId ? {
        exportId: data.exportId,
        bucket: data.exportBucket,
        s3Key: data.exportS3Key,
        fileSizeBytes: data.exportFileSizeBytes,
      } : null,
    };

    const deletionDb = tenantDb(adminKnex, data.tenantId);

    // Remove any previous completed/rolled-back/failed deletion records for this tenant
    // to avoid violating the unique constraint on the tenant column
    await deletionDb.table('pending_tenant_deletions')
      .whereIn('status', ['deleted', 'rolled_back', 'failed'])
      .delete();

    await deletionDb.table('pending_tenant_deletions').insert({
      deletion_id: data.deletionId,
      tenant: data.tenantId,
      trigger_source: data.triggerSource,
      triggered_by: data.triggeredBy,
      subscription_external_id: data.subscriptionExternalId,
      workflow_id: data.workflowId,
      workflow_run_id: data.workflowRunId,
      canceled_at: adminKnex.fn.now(),
      scheduled_deletion_date: scheduledDate,
      status: 'pending',
      stats_snapshot: JSON.stringify(statsSnapshot),
      created_at: adminKnex.fn.now(),
      updated_at: adminKnex.fn.now(),
    });

    log.info('Pending deletion recorded', { deletionId: data.deletionId, scheduledDate });
  } catch (error) {
    log.error('Failed to record pending deletion', {
      error: error instanceof Error ? error.message : 'Unknown error',
      deletionId: data.deletionId,
    });
    throw error;
  }
}

/**
 * Update the status of a pending tenant deletion
 */
export async function updateDeletionStatus(
  input: UpdateDeletionStatusInput
): Promise<void> {
  const log = logger();
  log.info('Updating deletion status', { deletionId: input.deletionId, status: input.status });

  try {
    const adminKnex = await getAdminConnection();

    const updateData: Record<string, any> = { updated_at: adminKnex.fn.now() };

    if (input.status) updateData.status = input.status;
    if (input.confirmationType) updateData.confirmation_type = input.confirmationType;
    if (input.confirmedBy) {
      updateData.confirmed_by = input.confirmedBy;
      updateData.confirmed_at = adminKnex.fn.now();
    }
    if (input.deletionScheduledFor) {
      updateData.deletion_scheduled_for = input.deletionScheduledFor;
    }
    if (input.rollbackReason) updateData.rollback_reason = input.rollbackReason;
    if (input.rolledBackBy) {
      updateData.rolled_back_by = input.rolledBackBy;
      updateData.rolled_back_at = adminKnex.fn.now();
    }
    if (input.status === 'deleted') {
      updateData.deleted_at = adminKnex.fn.now();
    }
    if (input.error) updateData.error = input.error;

    await adminKnex('pending_tenant_deletions')
      .where({ deletion_id: input.deletionId })
      .update(updateData);

    log.info('Deletion status updated', { deletionId: input.deletionId });
  } catch (error) {
    log.error('Failed to update deletion status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      deletionId: input.deletionId,
    });
    throw error;
  }
}

/**
 * Check if a table exists and has a tenant column
 */
async function getTableTenantColumn(
  knex: Knex,
  tableName: string
): Promise<TenantColumnName | null> {
  try {
    const result = await knex.raw(`
      SELECT c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_name = ?
        AND c.column_name IN ('tenant', 'tenant_id')
        AND c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY CASE c.column_name WHEN 'tenant' THEN 1 WHEN 'tenant_id' THEN 2 END
      LIMIT 1
    `, [tableName]);

    if (result.rows && result.rows.length > 0) {
      return result.rows[0].column_name as TenantColumnName;
    }
    return null;
  } catch {
    return null;
  }
}

function requireTenantDeletionBoundaryReason(reason: string): void {
  if (!reason || !reason.trim()) {
    throw new Error('Tenant deletion dynamic table boundary requires a reason');
  }
}

function tenantDeletionBoundaryReason(tableName: string): string {
  return `tenant deletion dynamic cleanup for schema-verified table ${tableName} from TENANT_TABLES_DELETION_ORDER`;
}

function tenantMetadataColumn(scope: Extract<TenantTableScope, { scope: 'tenant' }>): TenantColumnName {
  const column = scope.tenantColumn ?? 'tenant';
  if (column !== 'tenant' && column !== 'tenant_id') {
    throw new Error(`Unsupported tenant metadata column ${column}`);
  }
  return column;
}

async function resolveTenantDeletionTableBoundary(
  knex: Knex,
  tableName: string,
  reason: string
): Promise<TenantDeletionTableBoundary | null> {
  requireTenantDeletionBoundaryReason(reason);

  if (!TENANT_TABLES_DELETION_SET.has(tableName)) {
    throw new Error(`Table ${tableName} is not in TENANT_TABLES_DELETION_ORDER`);
  }

  const tenantColumn = await getTableTenantColumn(knex, tableName);
  if (!tenantColumn) {
    return null;
  }

  const metadataScope = getTenantTableScope(tableName);
  if (metadataScope?.scope === 'tenant') {
    const expectedTenantColumn = tenantMetadataColumn(metadataScope);
    if (tenantColumn !== expectedTenantColumn) {
      throw new Error(
        `Tenant deletion metadata/schema mismatch for ${tableName}: metadata expects ${expectedTenantColumn}, information_schema found ${tenantColumn}`
      );
    }
  }

  return {
    tableName,
    tenantColumn,
    metadataScope,
    reason,
  };
}

function explicitTenantDeletionTableQuery(
  knex: Knex,
  tenantId: string,
  boundary: TenantDeletionTableBoundary
) {
  const scopedDb = tenantDb(knex, tenantId);

  if (boundary.metadataScope?.scope === 'tenant') {
    return scopedDb.table(boundary.tableName);
  }

  if (boundary.metadataScope?.scope === 'admin') {
    throw new Error(`Admin table ${boundary.tableName} cannot be deleted through tenant deletion`);
  }

  return scopedDb
    .unscoped(boundary.tableName, boundary.reason)
    .where({ [boundary.tenantColumn]: tenantId });
}

/**
 * Break circular dependencies by nulling foreign key references.
 * This must be done before deleting records to avoid FK constraint violations.
 *
 * The circular dependency chains:
 * - clients.account_manager_id → users.user_id
 * - users.contact_id → contacts.contact_id (NOT NULL constraint!)
 * - contacts.client_id → clients.client_id
 *
 * - boards.inbound_reply_reopen_status_id → statuses.status_id (NO ACTION)
 * - statuses.board_id → boards.board_id (NO ACTION)
 *   (Both NO ACTION form a cycle. Deletion order keeps boards before statuses
 *    to respect the boards→statuses FK, so we null statuses.board_id here
 *    to allow boards to be deleted first.)
 *
 * - authorization_bundle_revisions.bundle_id → authorization_bundles.bundle_id
 * - authorization_bundles.published_revision_id → authorization_bundle_revisions.revision_id
 *   (Null published_revision_id first so revisions can be deleted before bundles.)
 *
 * - inbound_ticket_defaults.client_id → clients.client_id (NO ACTION)
 * - clients.inbound_ticket_defaults_id → inbound_ticket_defaults.id (NO ACTION)
 *   (Cycle. Deletion order has clients early and inbound_ticket_defaults late,
 *    so we null inbound_ticket_defaults.client_id here to let clients be
 *    deleted first; clients.inbound_ticket_defaults_id rows are gone by the
 *    time we get to inbound_ticket_defaults.)
 *
 * - opportunities.suggestion_id → opportunity_suggestions.suggestion_id
 * - opportunity_suggestions.created_opportunity_id → opportunities.opportunity_id
 *   (Cycle. Clear the opportunity back-reference so suggestions can be deleted
 *    first, followed by opportunities.)
 */
async function breakCircularDependencies(
  knex: Knex,
  tenantId: string,
  log: ReturnType<typeof logger>
): Promise<void> {
  log.info('Breaking circular dependencies for tenant', { tenantId });
  const tenantScopedDb = tenantDb(knex, tenantId);

  // Step 1: NULL out account_manager_id in clients to break clients → users dependency
  try {
    const result1 = await tenantScopedDb.table('clients')
      .whereNotNull('account_manager_id')
      .update({ account_manager_id: null });
    if (result1 > 0) {
      log.info('Cleared account_manager_id references in clients', { count: result1 });
    }
  } catch (error) {
    // Ignore if column doesn't exist
    log.debug('Could not clear account_manager_id in clients (column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 2: NULL out client_id in contacts to break contacts → clients dependency
  try {
    const result2 = await tenantScopedDb.table('contacts')
      .whereNotNull('client_id')
      .update({ client_id: null });
    if (result2 > 0) {
      log.info('Cleared client_id references in contacts', { count: result2 });
    }
  } catch (error) {
    // Ignore if column doesn't exist
    log.debug('Could not clear client_id in contacts (column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 3: NULL out statuses.board_id so boards can be deleted before statuses
  // without hitting the statuses_tenant_board_id_fk constraint (NO ACTION).
  try {
    const result3 = await tenantScopedDb.table('statuses')
      .whereNotNull('board_id')
      .update({ board_id: null });
    if (result3 > 0) {
      log.info('Cleared board_id references in statuses', { count: result3 });
    }
  } catch (error) {
    // Ignore if column doesn't exist (older schemas)
    log.debug('Could not clear board_id in statuses (column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 4: NULL out authorization_bundles.published_revision_id so
  // authorization_bundle_revisions can be deleted before authorization_bundles.
  try {
    const result4 = await tenantScopedDb.table('authorization_bundles')
      .whereNotNull('published_revision_id')
      .update({ published_revision_id: null });
    if (result4 > 0) {
      log.info('Cleared published_revision_id references in authorization_bundles', { count: result4 });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas)
    log.debug('Could not clear published_revision_id in authorization_bundles (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 5: NULL out inbound_ticket_defaults.client_id so clients can be
  // deleted before inbound_ticket_defaults (which lives in the late
  // configuration block). The reverse FK clients.inbound_ticket_defaults_id
  // is naturally cleared by the time we delete inbound_ticket_defaults.
  try {
    const result5 = await tenantScopedDb.table('inbound_ticket_defaults')
      .whereNotNull('client_id')
      .update({ client_id: null });
    if (result5 > 0) {
      log.info('Cleared client_id references in inbound_ticket_defaults', { count: result5 });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas)
    log.debug('Could not clear client_id in inbound_ticket_defaults (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 6: NULL out assets.stock_unit_id so stock_units can be deleted before
  // assets. assets.stock_unit_id -> stock_units and stock_units.asset_id -> assets
  // form a restrictive cycle; the inventory block deletes stock_units before
  // assets, so clear the back-reference here (exempted in validate-tenant-management).
  try {
    const result6 = await tenantScopedDb.table('assets')
      .whereNotNull('stock_unit_id')
      .update({ stock_unit_id: null });
    if (result6 > 0) {
      log.info('Cleared stock_unit_id references in assets', { count: result6 });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas or CE without inventory)
    log.debug('Could not clear stock_unit_id in assets (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 6b: NULL out stock_units.allocated_staging_line_id so project_staging_lines
  // can be deleted. project_staging_lines.unit_id -> stock_units (project_staging_lines_unit_fk)
  // and stock_units.allocated_staging_line_id -> project_staging_lines
  // (fk_stock_units_allocated_staging_line) are both NO ACTION and form a restrictive
  // cycle; the inventory block deletes project_staging_lines before stock_units, which is
  // only legal once units no longer point at lines (exempted in validate-tenant-management).
  try {
    const result6b = await tenantScopedDb.table('stock_units')
      .whereNotNull('allocated_staging_line_id')
      .update({ allocated_staging_line_id: null });
    if (result6b > 0) {
      log.info('Cleared allocated_staging_line_id references in stock_units', { count: result6b });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas or CE without project staging)
    log.debug('Could not clear allocated_staging_line_id in stock_units (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 7: NULL out opportunities.suggestion_id so opportunity_suggestions
  // can be deleted before opportunities. The reverse created_opportunity_id FK
  // is then naturally satisfied by the child-first deletion order.
  try {
    const result7 = await tenantScopedDb.table('opportunities')
      .whereNotNull('suggestion_id')
      .update({ suggestion_id: null });
    if (result7 > 0) {
      log.info('Cleared suggestion_id references in opportunities', { count: result7 });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas without Opportunities).
    log.debug('Could not clear suggestion_id in opportunities (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  // Step 8: NULL out tenant_settings.default_tax_rate_id so tax_rates (deleted
  // earlier in the order) is not blocked by the composite RESTRICT FK. The
  // setting row itself is deleted later; clearing the reference first keeps the
  // tenant from being left with orphaned tax rates.
  try {
    const result8 = await tenantScopedDb.table('tenant_settings')
      .whereNotNull('default_tax_rate_id')
      .update({ default_tax_rate_id: null });
    if (result8 > 0) {
      log.info('Cleared default_tax_rate_id references in tenant_settings', { count: result8 });
    }
  } catch (error) {
    // Ignore if table/column doesn't exist (older schemas before the setting).
    log.debug('Could not clear default_tax_rate_id in tenant_settings (table or column may not exist)', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
  }

  log.info('Circular dependencies broken successfully');
}

/**
 * Delete all tenant data comprehensively.
 * Uses the table deletion order from cli/cleanup-tenant.nu.
 *
 * CRITICAL SAFEGUARDS:
 * 1. Validates tenantId is not the master/management tenant
 * 2. Explicitly excludes master tenant from all deletion queries
 * 3. Logs all deletions before executing
 */
export async function deleteTenantData(
  tenantId: string,
  deletionId: string
): Promise<DeleteTenantDataResult> {
  const log = logger();
  log.info('Starting comprehensive tenant data deletion', { tenantId, deletionId });

  try {
    let adminKnex = await getAdminConnection();

    // Per-op wrapper that reuses `adminKnex` across calls — on a read-only
    // failure, the refresh callback updates the closure variable so the
    // remainder of this deletion uses the new pool without re-probing.
    const withReadOnlyRetry = <T>(
      op: (k: Knex) => Promise<T>,
      label: string
    ): Promise<T> =>
      retryOnReadOnly(
        () => op(adminKnex),
        async () => {
          adminKnex = await refreshAdminConnection();
        },
        {
          logLabel: label,
          logger: { warn: (msg, meta) => log.warn(msg, meta as any) },
        }
      );

    // ============================================================
    // CRITICAL SAFEGUARD 1: Validate tenant is not master tenant
    // ============================================================
    const managementTenantId = await getManagementTenantIdInternal(adminKnex);

    if (tenantId === managementTenantId) {
      log.error('BLOCKED: Attempted to delete master/management tenant in deleteTenantData', {
        tenantId,
        managementTenantId,
        deletionId,
      });
      return {
        success: false,
        error: 'BLOCKED: Cannot delete master/management tenant. This is a critical safety check.',
      };
    }

    // ============================================================
    // CRITICAL SAFEGUARD 2: Verify the tenant exists and get info
    // ============================================================
    const tenantInfo = await tenantDb(adminKnex, tenantId).table('tenants').first();
    if (!tenantInfo) {
      log.error('Tenant not found for deletion', { tenantId, deletionId });
      return {
        success: false,
        error: `Tenant ${tenantId} not found`,
      };
    }

    log.info('Tenant deletion safeguards passed', {
      tenantId,
      tenantName: tenantInfo.client_name,
      managementTenantId,
      deletionId,
    });

    let totalDeleted = 0;
    let tablesAffected = 0;
    const errors: string[] = [];

    // Step 1: Break circular dependencies first
    await withReadOnlyRetry(
      (k) => breakCircularDependencies(k, tenantId, log),
      'breakCircularDependencies'
    );

    // Step 2: Delete from each table in order
    // The loop runs the manifest order. The local binding keeps the established loop
    // shape that source-text contract tests assert; the exported literal above is the
    // golden copy `tenantTableManifest.golden.test.ts` compares against.
    const TENANT_TABLES_DELETION_ORDER = tenantDeletionOrder();
    for (const tableName of TENANT_TABLES_DELETION_ORDER) {
      try {
        const tableBoundary = await resolveTenantDeletionTableBoundary(
          adminKnex,
          tableName,
          tenantDeletionBoundaryReason(tableName)
        );

        if (tableBoundary) {
          // Count records first - with explicit tenant check
          const countResult = await explicitTenantDeletionTableQuery(adminKnex, tenantId, tableBoundary)
            .count('* as count')
            .first();

          const count = Number(countResult?.count || 0);

          if (count > 0) {
            // ============================================================
            // CRITICAL SAFEGUARD 3: Double-check we're not deleting from
            // master tenant by verifying the WHERE clause
            // ============================================================
            if (managementTenantId) {
              // Log what we're about to delete for audit trail
              log.info(`Pre-deletion check: ${tableName}`, {
                tableName,
                tenantColumn: tableBoundary.tenantColumn,
                tenantId,
                managementTenantId,
                recordCount: count,
                isSafe: tenantId !== managementTenantId,
              });
            }

            // Delete records with explicit tenant filter
            const deleted = await withReadOnlyRetry(
              (k) => explicitTenantDeletionTableQuery(k, tenantId, tableBoundary).delete(),
              `delete:${tableName}`
            );

            totalDeleted += deleted;
            tablesAffected++;
            log.info(`Deleted ${deleted} records from ${tableName}`, {
              tableName,
              deleted,
              tenantId,
            });
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        // Log but continue - some tables may not exist or have different schema
        log.warn(`Failed to delete from ${tableName}: ${errorMsg}`);
        errors.push(`${tableName}: ${errorMsg}`);
      }
    }

    // Step 3: Delete pending_tenant_deletions records for this tenant (except current)
    try {
      const deletedPending = await withReadOnlyRetry(
        (k) =>
          tenantDb(k, tenantId).table('pending_tenant_deletions')
            .whereNot({ deletion_id: deletionId })
            .delete(),
        'delete:pending_tenant_deletions'
      );

      if (deletedPending > 0) {
        log.info(`Deleted ${deletedPending} old pending deletion records`);
        totalDeleted += deletedPending;
      }
    } catch (error) {
      log.warn('Could not delete pending_tenant_deletions records', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }

    // Step 4: Delete the tenant record itself (with final safety check)
    try {
      // Final safeguard before deleting tenant record
      if (tenantId === managementTenantId) {
        throw new Error('BLOCKED: Final safety check failed - cannot delete management tenant');
      }

      await withReadOnlyRetry(
        (k) => tenantDb(k, tenantId).table('tenants').delete(),
        'delete:tenants'
      );

      totalDeleted++;
      tablesAffected++;
      log.info('Deleted tenant record from tenants table', { tenantId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to delete tenant record', { error: errorMsg, tenantId });
      errors.push(`tenants: ${errorMsg}`);
    }

    log.info('Tenant data deletion completed', {
      tenantId,
      deletionId,
      totalDeleted,
      tablesAffected,
      errorCount: errors.length,
    });

    // Any per-table failure leaves the tenant in a half-deleted state (orphan rows
    // blocking re-signup, FK violations on re-runs), so surface it as a failure
    // instead of silently reporting success.
    if (errors.length > 0) {
      log.error('Tenant data deletion had table-level errors', { errors });
      return {
        success: false,
        error: `Deletion failed for ${errors.length} table(s): ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '; ...' : ''}`,
        deletedRecords: totalDeleted,
        tablesAffected,
        tableErrors: errors,
      };
    }

    return {
      success: true,
      deletedRecords: totalDeleted,
      tablesAffected,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to delete tenant data', {
      error: errorMsg,
      tenantId,
      deletionId,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Result of canceling a Stripe subscription
 */
export interface CancelSubscriptionResult {
  canceled: boolean;
  subscriptionId?: string;
  error?: string;
}

/**
 * Cancel active Stripe subscription for a tenant
 * This is called when deletion is triggered from extension/manual (not from Stripe webhook)
 */
export async function cancelTenantStripeSubscription(
  tenantId: string
): Promise<CancelSubscriptionResult> {
  const log = logger();
  log.info('Canceling Stripe subscription for tenant', { tenantId });

  try {
    const adminKnex = await getAdminConnection();

    // Find any billable subscription for this tenant (active, trialing, past_due, or unpaid)
    const tenantScopedDb = tenantDb(adminKnex, tenantId);

    const activeSubscription = await tenantScopedDb.table('stripe_subscriptions')
      .whereIn('status', ['active', 'trialing', 'past_due', 'unpaid'])
      .first();

    if (!activeSubscription) {
      log.info('No active Stripe subscription found for tenant', { tenantId });
      return { canceled: false };
    }

    const subscriptionExternalId = activeSubscription.stripe_subscription_external_id;
    log.info('Found active subscription, canceling', { subscriptionExternalId });

    // Dynamically import Stripe to avoid issues in environments where it's not available
    const { createWorkerStripeClient } = await import('../config/stripeClient.js');
    const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');

    const secretProvider = await getSecretProviderInstance();
    let secretKey = await secretProvider.getAppSecret('stripe_secret_key');
    if (!secretKey && process.env.STRIPE_SECRET_KEY) {
      secretKey = process.env.STRIPE_SECRET_KEY;
    }

    if (!secretKey) {
      log.error('Stripe secret key not configured');
      return { canceled: false, error: 'Stripe secret key not configured' };
    }

    const stripe = createWorkerStripeClient(secretKey);

    // Cancel the subscription immediately
    const canceledSubscription = await stripe.subscriptions.cancel(subscriptionExternalId);

    // Update our database to reflect the cancellation
    await tenantScopedDb.table('stripe_subscriptions')
      .where({ stripe_subscription_id: activeSubscription.stripe_subscription_id })
      .update({
        status: 'canceled',
        canceled_at: adminKnex.fn.now(),
        updated_at: adminKnex.fn.now(),
      });

    log.info('Stripe subscription canceled successfully', {
      tenantId,
      subscriptionId: subscriptionExternalId,
      stripeStatus: canceledSubscription.status,
    });

    return {
      canceled: true,
      subscriptionId: subscriptionExternalId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to cancel Stripe subscription', {
      error: errorMsg,
      tenantId,
    });
    // Don't throw - subscription cancellation failure shouldn't block deletion workflow
    return { canceled: false, error: errorMsg };
  }
}

// Email template color scheme (matches brand from welcome email)
const EMAIL_COLORS = {
  primary: '#8a4dea',
  primaryLight: '#a366f0',
  textPrimary: '#0f172a',
  textSecondary: '#334155',
  textMuted: '#64748b',
  textLight: '#94a3b8',
  textOnDark: '#cbd5e1',
  bgSecondary: '#f8fafc',
  bgDark: '#1e293b',
  borderLight: '#e2e8f0',
};

function createDeactivationEmailContent(tenantName: string, userName: string): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const currentYear = new Date().getFullYear();
  const supportEmail = 'info@nineminds.com';

  const subject = `Your AlgaPSA account has been deactivated`;

  const htmlBody = `
  <!DOCTYPE html>
  <html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Deactivation Notice</title>
    <style type="text/css">
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700&display=swap');
      table {border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt;}
      a {text-decoration: none; color: ${EMAIL_COLORS.primary};}
      h1, h2, h3, p {margin: 0; padding: 0;}
      .ExternalClass {width: 100%;}
      .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td {line-height: 100%;}
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${EMAIL_COLORS.bgSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
      <tr>
        <td>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="border-collapse: collapse;" bgcolor="${EMAIL_COLORS.bgSecondary}">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);" bgcolor="#ffffff">
              <tr>
                <td>
                  <!-- Header -->
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                    <tr>
                      <td align="center" bgcolor="${EMAIL_COLORS.primary}" style="background: linear-gradient(135deg, ${EMAIL_COLORS.primary} 0%, ${EMAIL_COLORS.primaryLight} 100%); background-color: ${EMAIL_COLORS.primary}; padding: 40px 24px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-weight: 700; font-size: 28px; color: #ffffff; margin: 0 0 8px 0; line-height: 1.2;">Account Deactivated</h1>
                        <p style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; color: #ffffff; margin: 0; opacity: 0.95;">Your account has been deactivated</p>
                      </td>
                    </tr>
                  </table>

                  <!-- Main Content -->
                  <tr>
                    <td bgcolor="#ffffff" style="background-color: #ffffff; padding: 40px 32px;">
                      <h2 style="color: ${EMAIL_COLORS.textPrimary}; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 22px; font-weight: 600; margin-bottom: 16px;">Hello ${userName},</h2>

                      <p style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 16px; margin-bottom: 24px;">Your <b style="color: ${EMAIL_COLORS.textPrimary};">${tenantName}</b> account on AlgaPSA has been deactivated. We're sorry to see you go.</p>

                      <!-- What happens next -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; margin: 24px 0;">
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate; border-radius: 8px; overflow: hidden;">
                              <tr>
                                <td bgcolor="#faf8ff" style="background-color: #faf8ff; border-left: 4px solid ${EMAIL_COLORS.primary}; padding: 24px; border-radius: 8px;">
                                  <h3 style="color: ${EMAIL_COLORS.textPrimary}; font-size: 18px; font-weight: 600; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">What happens next:</h3>
                                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                                    <tr>
                                      <td style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${EMAIL_COLORS.primary};">1.</b> Your account has been deactivated and <b>you will no longer be charged</b>.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${EMAIL_COLORS.primary};">2.</b> All user accounts have been deactivated.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding-bottom: 10px; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${EMAIL_COLORS.primary};">3.</b> Your data will be retained for a grace period before permanent deletion, in case you change your mind.
                                      </td>
                                    </tr>
                                    <tr>
                                      <td style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; font-size: 15px;">
                                        <b style="color: ${EMAIL_COLORS.primary};">4.</b> A copy of your data has been exported and is available upon request.
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <!-- Changed your mind -->
                      <p style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 16px; margin-bottom: 16px;">If you've changed your mind or this was a mistake, please contact our support team at <a href="mailto:${supportEmail}" style="color: ${EMAIL_COLORS.primary}; font-weight: 600;">${supportEmail}</a> as soon as possible and we can restore your account during the grace period.</p>

                      <!-- Divider -->
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                        <tr>
                          <td style="padding: 24px 0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                              <tr>
                                <td style="height: 1px; background-color: ${EMAIL_COLORS.borderLight}; font-size: 1px; line-height: 1px;">&nbsp;</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <p style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 15px; margin-bottom: 8px;">Thank you for being an AlgaPSA customer. We truly appreciate your business and hope to work with you again in the future.</p>

                      <p style="color: ${EMAIL_COLORS.textSecondary}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; font-size: 15px; margin-top: 20px;">Best regards,<br><b style="color: ${EMAIL_COLORS.textPrimary};">The AlgaPSA Team</b></p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" bgcolor="${EMAIL_COLORS.bgDark}" style="background-color: ${EMAIL_COLORS.bgDark}; color: ${EMAIL_COLORS.textOnDark}; padding: 32px 24px; text-align: center; font-size: 14px; line-height: 1.6; border-radius: 0 0 12px 12px;">
                      <p style="color: ${EMAIL_COLORS.textOnDark}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 8px 0;">This email was sent as part of your account deactivation process.</p>
                      <p style="color: ${EMAIL_COLORS.textOnDark}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0 0 16px 0;">If you did not request this, please contact support immediately.</p>
                      <p style="color: ${EMAIL_COLORS.textLight}; font-size: 13px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0;">&copy; ${currentYear} Nine Minds. All rights reserved.</p>
                    </td>
                  </tr>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;

  const textBody = `
Account Deactivated

Hello ${userName},

Your "${tenantName}" account on AlgaPSA has been deactivated. We're sorry to see you go.

WHAT HAPPENS NEXT:

1. Your account has been deactivated and you will no longer be charged.
2. All user accounts have been deactivated.
3. Your data will be retained for a grace period before permanent deletion, in case you change your mind.
4. A copy of your data has been exported and is available upon request.

If you've changed your mind or this was a mistake, please contact our support team at ${supportEmail} as soon as possible and we can restore your account during the grace period.

Thank you for being an AlgaPSA customer. We truly appreciate your business and hope to work with you again in the future.

Best regards,
The AlgaPSA Team

---
This email was sent as part of your account deactivation process.
If you did not request this, please contact support immediately.

(c) ${currentYear} Nine Minds. All rights reserved.
  `.trim();

  return { subject, htmlBody, textBody };
}

/**
 * Send account deactivation email to the tenant's registered email address.
 * Called during the tenant deletion workflow after users have been deactivated.
 *
 * Note: The "cancellation request received" email (for user-initiated cancellations)
 * is sent separately by cancelSubscriptionAction when the user clicks Cancel.
 * This activity always sends the "account deactivated" email.
 */
export async function sendCancellationConfirmationEmail(
  tenantId: string,
  tenantName: string,
): Promise<SendCancellationEmailResult> {
  const log = logger();
  log.info('Sending account deactivation email to tenant', { tenantId, tenantName });

  const result: SendCancellationEmailResult = {
    emailsSent: 0,
    emailsFailed: 0,
    errors: [],
  };

  try {
    const adminKnex = await getAdminConnection();

    // Get the tenant's registered email address
    const tenant = await tenantDb(adminKnex, tenantId).table('tenants')
      .select('email', 'client_name')
      .first();

    if (!tenant?.email) {
      log.info('No email address found for tenant', { tenantId });
      return result;
    }

    log.info('Sending cancellation email to tenant email', { tenantId, email: tenant.email });

    const { emailService: emailServicePromise } = await import('../services/email-service.js');
    const emailServiceInstance = await emailServicePromise;

    const recipientName = tenant.client_name || tenantName;
    const { subject, htmlBody, textBody } = createDeactivationEmailContent(tenantName, recipientName);

    try {
      await emailServiceInstance.sendEmail({
        to: tenant.email,
        from: 'info@nineminds.com',
        subject,
        html: htmlBody,
        text: textBody,
        metadata: {
          tenantId,
          emailType: 'account_deactivated',
          workflowType: 'tenant_deletion',
        },
      });

      result.emailsSent++;
      log.info('Deactivation email sent', { email: tenant.email });
    } catch (emailError) {
      result.emailsFailed++;
      const errorMsg = emailError instanceof Error ? emailError.message : 'Unknown error';
      result.errors!.push(`${tenant.email}: ${errorMsg}`);
      log.warn('Failed to send cancellation email', { email: tenant.email, error: errorMsg });
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to send cancellation confirmation email', { error: errorMsg, tenantId });
    // Don't throw - email failure shouldn't block deletion workflow
    result.errors!.push(errorMsg);
    return result;
  }
}

export async function linkSubscriptionToExistingTenant(
  input: LinkSubscriptionToExistingTenantInput,
): Promise<LinkSubscriptionToExistingTenantResult> {
  const log = Context.current().log;
  const knex = await getAdminConnection();

  const tenantScopedDb = tenantDb(knex, input.tenantId);

  const existingActiveSubscription = await tenantScopedDb.table('stripe_subscriptions')
    .whereIn('status', ['active', 'trialing'])
    .first('stripe_subscription_external_id');

  if (existingActiveSubscription) {
    log.warn('Tenant already has an active linked subscription; refusing duplicate link', {
      tenantId: input.tenantId,
      existingSubscription: existingActiveSubscription.stripe_subscription_external_id,
      attemptedSubscription: input.stripeSubscriptionId,
    });
    return {
      linked: false,
      duplicateActiveSubscription: true,
      stripeSubscriptionId: existingActiveSubscription.stripe_subscription_external_id,
    };
  }

  const result = await knex.transaction(async (trx) => {
    const tenantScopedTrx = tenantDb(trx, input.tenantId);

    let stripeCustomer = await tenantScopedTrx.table('stripe_customers')
      .where({
        stripe_customer_external_id: input.stripeCustomerId,
      })
      .first('*');

    if (!stripeCustomer) {
      stripeCustomer = await tenantScopedTrx.table('stripe_customers')
        .orderBy('created_at', 'asc')
        .first('*');
    }

    if (!stripeCustomer) {
      const MASTER_TENANT_ID = await getSecret('master_billing_tenant_id', 'MASTER_BILLING_TENANT_ID');
      if (!MASTER_TENANT_ID) {
        throw new Error('MASTER_BILLING_TENANT_ID not configured');
      }

      [stripeCustomer] = await tenantScopedTrx.table('stripe_customers')
        .insert({
          tenant: input.tenantId,
          stripe_customer_id: trx.raw('gen_random_uuid()'),
          stripe_customer_external_id: input.stripeCustomerId,
          billing_tenant: MASTER_TENANT_ID,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .returning('*');
    }

    const subscriptionInsert = await insertStripeSubscriptionForTenant(trx, {
      tenantId: input.tenantId,
      stripeCustomerInternalId: stripeCustomer.stripe_customer_id,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeSubscriptionItemId: input.stripeSubscriptionItemId,
      stripePriceId: input.stripePriceId,
      quantity: 1,
    });

    return subscriptionInsert.inserted;
  });

  return {
    linked: result,
    duplicateActiveSubscription: false,
    stripeSubscriptionId: input.stripeSubscriptionId,
  };
}

export async function stampReactivationSubscriptionMetadata(input: {
  tenantId: string;
  stripeSubscriptionId: string;
}): Promise<void> {
  await updateSubscriptionMetadata(input.stripeSubscriptionId, {
    tenant_id: input.tenantId,
  });
}

export async function triggerReactivationPasswordReset(
  input: TriggerReactivationPasswordResetInput,
): Promise<{ success: boolean }> {
  const knex = await getAdminConnection();
  const tenant = await tenantDb(knex, input.tenantId).table('tenants')
    .first('email');
  const email = tenant?.email;
  if (!email) {
    throw new Error(`No tenant email found for ${input.tenantId}`);
  }

  const secret = process.env.ALGA_WEBHOOK_SECRET;
  const baseUrl = process.env.ALGA_APP_BASE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (!secret || !baseUrl) {
    throw new Error('ALGA_WEBHOOK_SECRET and app base URL are required for password reset trigger');
  }

  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${email}:${timestamp}`)
    .digest('hex');

  const response = await fetch(`${baseUrl}/api/billing/reactivation-password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Timestamp': timestamp,
    },
    body: JSON.stringify({ email }),
  });

  // Throw on a non-2xx so Temporal retries (the proxyActivities policy bounds
  // this at maximumAttempts). A swallowed failure would leave a reactivated,
  // billed tenant with no way to log in and no signal to anyone.
  if (!response.ok) {
    throw new Error(`Reactivation password reset request failed: ${response.status}`);
  }

  return { success: true };
}

export async function recordReactivationPaymentAlert(
  input: RecordReactivationPaymentAlertInput,
): Promise<{ success: boolean }> {
  const log = Context.current().log;
  const knex = await getAdminConnection();

  await tenantDb(knex, input.tenantId).table('pending_reactivation_refunds').insert({
    tenant: input.tenantId,
    stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
    stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
    stripe_subscription_external_id: input.stripeSubscriptionExternalId ?? null,
    reason: input.reason,
    created_at: knex.fn.now(),
  });

  const opsEmail = process.env.REACTIVATION_REFUND_ALERT_EMAIL || process.env.BILLING_OPS_EMAIL;
  if (opsEmail) {
    try {
      const { emailService: emailServicePromise } = await import('../services/email-service.js');
      const emailServiceInstance = await emailServicePromise;
      await emailServiceInstance.sendEmail({
        to: opsEmail,
        from: 'info@nineminds.com',
        subject: `Manual reactivation payment review: ${input.reason}`,
        html: [
          '<h1>Manual reactivation payment review</h1>',
          `<p>Tenant: ${input.tenantId}</p>`,
          `<p>Reason: ${input.reason}</p>`,
          `<p>Checkout session: ${input.stripeCheckoutSessionId ?? 'n/a'}</p>`,
          `<p>Payment intent: ${input.stripePaymentIntentId ?? 'n/a'}</p>`,
          `<p>Subscription: ${input.stripeSubscriptionExternalId ?? 'n/a'}</p>`,
        ].join(''),
        text: `Manual reactivation payment review\nTenant: ${input.tenantId}\nReason: ${input.reason}\nCheckout session: ${input.stripeCheckoutSessionId ?? 'n/a'}\nPayment intent: ${input.stripePaymentIntentId ?? 'n/a'}\nSubscription: ${input.stripeSubscriptionExternalId ?? 'n/a'}`,
        metadata: {
          tenantId: input.tenantId,
          entityType: 'tenant_reactivation',
          entityId: input.stripeCheckoutSessionId ?? input.tenantId,
        },
      });
    } catch (error) {
      log.error('Failed to send reactivation payment alert email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId: input.tenantId,
      });
    }
  }

  return { success: true };
}

/**
 * Delete every recurring Temporal Schedule owned by a tenant.
 *
 * Every per-tenant schedule — accounting-sync-cycle, rmm-alert-reconciliation,
 * huntress-incident-poll, and workflow-v2 `workflow-schedule:*` — is created by
 * TemporalJobRunner, which bakes `{ tenantId }` into the started workflow's
 * `args[0]`. We match on that baked tenantId rather than the schedule id: the
 * `workflow-schedule:<workflowId>:<scheduleId>` ids carry no tenant, so an
 * id-substring match would silently orphan them. Global maintenance schedules
 * run `maintenanceJobWorkflow` with no tenantId and are left untouched.
 *
 * Must run BEFORE deleteTenantData drops the `jobs` table, otherwise the
 * schedules keep firing genericJobWorkflow against deleted parent rows and fail
 * their FK bookkeeping on every fire (the orphaned-schedule bug this closes).
 * Idempotent: safe to retry — a re-run re-lists and skips anything already gone.
 */
export async function deleteTenantSchedules(
  tenantId: string
): Promise<{ deletedScheduleIds: string[] }> {
  const log = logger();
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233',
  });
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  });

  const deletedScheduleIds: string[] = [];
  try {
    for await (const summary of client.schedule.list()) {
      const { scheduleId } = summary;

      let belongsToTenant = false;
      try {
        const description = await client.schedule.getHandle(scheduleId).describe();
        const action = description.action as { type?: string; args?: unknown[] };
        const firstArg = action?.type === 'startWorkflow' ? action.args?.[0] : undefined;
        const bakedTenantId =
          firstArg && typeof firstArg === 'object'
            ? (firstArg as { tenantId?: unknown }).tenantId
            : undefined;
        belongsToTenant = bakedTenantId === tenantId;
      } catch (describeError) {
        // Vanished between list and describe, or not a start-workflow schedule
        // we can introspect — skip rather than block the deletion.
        log.warn('Could not describe schedule during tenant teardown', {
          tenantId,
          scheduleId,
          error: describeError instanceof Error ? describeError.message : String(describeError),
        });
        continue;
      }

      if (!belongsToTenant) continue;

      try {
        await client.schedule.getHandle(scheduleId).delete();
        deletedScheduleIds.push(scheduleId);
        log.info('Deleted tenant schedule', { tenantId, scheduleId });
      } catch (deleteError) {
        const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
        // Idempotent: a concurrent delete already removed it.
        if (/not.?found/i.test(message)) continue;
        throw deleteError;
      }
    }

    log.info('Tenant schedule teardown complete', {
      tenantId,
      deletedCount: deletedScheduleIds.length,
      deletedScheduleIds,
    });
    return { deletedScheduleIds };
  } finally {
    await connection.close().catch(() => {});
  }
}
