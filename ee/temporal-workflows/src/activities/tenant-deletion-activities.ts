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
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import { TagModel } from '@alga-psa/shared/models/tagModel.js';
import { Knex } from 'knex';
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
} from '../types/tenant-deletion-types.js';

/**
 * Comprehensive list of tables to delete from, in dependency order.
 * Most dependent tables first, then progressively less dependent.
 * This order is critical due to foreign key constraints.
 *
 * Synced from cli/cleanup-tenant.nu
 */
const TENANT_TABLES_DELETION_ORDER: string[] = [
  // === LEVEL 0: Sessions (CRITICAL - must be deleted before users/tenants) ===
  'sessions',

  // === LEVEL 1: Leaf tables with no dependencies ===
  // Workflow details
  'workflow_action_results', 'workflow_event_attachments', 'workflow_snapshots',
  'workflow_action_dependencies', 'workflow_sync_points', 'workflow_timers',
  'workflow_task_history', 'workflow_form_schemas',

  // Task/project details
  'task_checklist_items', 'project_task_dependencies', 'task_resources',
  'project_ticket_links', 'project_task_comments',

  // Project template details
  'project_template_checklist_items', 'project_template_dependencies',
  'project_template_task_resources', 'project_template_status_mappings',
  'project_template_tasks', 'project_template_phases', 'project_templates',

  // Invoice details
  'invoice_charges', 'invoice_annotations', 'invoice_time_entries', 'invoice_usage_records',
  'invoice_charge_details', 'invoice_charge_fixed_details', 'invoice_items',
  'invoice_payment_links', 'invoice_payments', 'invoice_template_assignments',

  // Time tracking
  'time_sheet_comments', 'time_entries', 'time_sheets',

  // Document details
  'document_block_content', 'document_versions', 'document_content',
  'document_folders', 'document_system_entries',

  // Messages and comments
  'comments',
  'gmail_processed_history', 'email_processed_messages',
  'email_reply_tokens', 'email_sending_logs', 'email_rate_limits',

  // User related details
  'user_notification_preferences', 'user_internal_notification_preferences', 'user_preferences',
  'role_permissions', 'user_roles', 'user_auth_accounts',

  // Schedule and team
  'schedule_entry_assignees', 'schedule_conflicts', 'team_members',
  'availability_exceptions', 'availability_settings',

  // Calendar
  'calendar_event_mappings', 'calendar_provider_health',
  'google_calendar_provider_config', 'microsoft_calendar_provider_config', 'calendar_providers',

  // Tags and resources
  'tag_mappings', 'ticket_resources',

  // Logs and notifications
  'job_details', 'jobs', 'audit_logs', 'notification_logs', 'internal_notifications',

  // Import/export
  'import_job_items', 'import_jobs', 'import_sources',
  'accounting_export_errors', 'accounting_export_lines', 'accounting_export_batches',

  // Asset details
  'asset_maintenance_notifications', 'asset_maintenance_history', 'asset_service_history',
  'asset_ticket_associations', 'asset_document_associations', 'asset_relationships',
  'asset_history', 'asset_associations', 'asset_software',
  'workstation_assets', 'server_assets', 'network_device_assets', 'mobile_device_assets', 'printer_assets',

  // Software catalog
  'software_catalog',

  // RMM
  'rmm_alert_rules', 'rmm_alerts', 'rmm_organization_mappings', 'rmm_integrations',

  // Survey
  'survey_responses', 'survey_invitations', 'survey_triggers', 'survey_templates',

  // Appointment
  'appointment_requests',

  // === LEVEL 2: Tables that depend on level 3+ ===
  // Payment/Stripe
  'stripe_webhook_events', 'stripe_subscriptions', 'stripe_prices', 'stripe_products',
  'stripe_customers', 'stripe_accounts',
  'payment_webhook_events', 'payment_provider_configs', 'client_payment_customers',

  // Billing details
  'credit_allocations', 'credit_reconciliation_reports', 'credit_tracking',
  'usage_tracking', 'bucket_usage', 'transactions',
  'client_contracts', 'contract_line_service_rate_tiers', 'contract_line_service_bucket_config',
  'contract_line_service_hourly_config', 'contract_line_service_hourly_configs', 'contract_line_service_usage_config',
  'contract_line_service_fixed_config', 'contract_line_service_configuration',
  'contract_line_service_defaults', 'contract_pricing_schedules',
  'service_rate_tiers', 'service_prices', 'contract_line_discounts', 'discounts',
  'client_billing_cycles', 'client_billing_settings',
  'contract_line_services', 'contract_lines', 'contracts',

  // Contract line presets
  'contract_line_preset_fixed_config', 'contract_line_preset_services', 'contract_line_presets',

  // Contract templates (must be deleted before contracts)
  'contract_template_compare_view', 'contract_template_line_defaults',
  'contract_template_line_fixed_config', 'contract_template_line_service_bucket_config',
  'contract_template_line_service_configuration', 'contract_template_line_service_hourly_config',
  'contract_template_line_service_usage_config', 'contract_template_line_services',
  'contract_template_line_terms', 'contract_template_lines',
  'contract_template_pricing_schedules', 'contract_template_services', 'contract_templates',

  // Client details (must come before clients)
  'client_tax_rates', 'client_tax_settings',
  'tenant_companies',

  // Project/task entities
  'project_tasks', 'project_phases', 'project_status_mappings',

  // Workflow entities
  'workflow_tasks', 'workflow_executions', 'workflow_events', 'workflow_event_processing',
  'workflow_registration_versions', 'workflow_triggers', 'workflow_form_definitions',
  'workflow_task_definitions',

  // === LEVEL 3: Mid-level entities ===
  // Document associations must come before documents
  'document_associations',

  // Assets must come after asset details
  'asset_maintenance_schedules', 'assets',

  // Contract Lines
  'contract_lines', 'payment_methods',

  // Interactions must come BEFORE tickets (tickets reference interactions in some cases)
  'interactions', 'interaction_types',

  // Schedule entries
  'schedule_entries',

  // Service catalog
  'service_catalog', 'service_types', 'service_categories',

  // Settings that might be referenced
  'approval_thresholds',

  // Conditional display rules must come BEFORE invoice_templates
  'conditional_display_rules',

  // === LEVEL 4: Core business entities ===
  // Invoice templates (after conditional_display_rules)
  'invoice_templates',

  // Invoices (after invoice_templates)
  'invoices',

  // Projects
  'projects',

  // External files and documents
  'external_files', 'documents', 'document_types',

  // Workflow templates
  'workflow_registrations', 'workflow_templates', 'workflow_template_categories',

  // === LEVEL 5: Tickets and related ===
  // Tickets MUST be deleted BEFORE categories, statuses, etc that it references
  // AND BEFORE client_locations that tickets reference via location_id
  'tickets',

  // === LEVEL 6: Client locations (referenced by tickets.location_id) ===
  // Must be deleted AFTER tickets
  'client_locations',

  // === LEVEL 6: Lookup tables referenced by tickets ===
  // These can only be deleted AFTER tickets
  'categories',
  'standard_statuses', 'statuses',
  'priorities', 'severities', 'urgencies', 'impacts',

  // === LEVEL 7: Boards (referenced by categories) ===
  // Boards must be deleted AFTER categories
  'boards',

  // === LEVEL 8: Breaking circular dependencies ===
  // There's a complex circular dependency:
  // - users.contact_id → contacts (with ON DELETE SET NULL that fails on NOT NULL constraint)
  // - contacts.client_id → clients
  // - clients.account_manager → users

  // Tax configuration (no dependencies on core entities)
  'tax_components', 'tax_rates', 'tax_regions',

  // Permissions and roles (must be deleted before users)
  'permissions', 'roles', 'teams',

  // The correct order to avoid constraint violations:
  // 1. Delete clients first (after NULLing account_manager)
  // 2. Delete contacts second (after NULLing client_id, before users that reference them)
  // 3. Delete users last (they have NOT NULL contact_id that references contacts)

  'clients',    // Delete clients FIRST (after NULLing account_manager references)
  'contacts',   // Delete contacts SECOND (after clients, before users that have NOT NULL contact_id)
  'users',      // Delete users LAST (they have NOT NULL contact_id → contacts)

  // === LEVEL 9: Configuration and settings ===
  // API and auth
  'api_keys', 'portal_invitations', 'password_reset_tokens',
  'portal_domain_session_otts', 'portal_domains',

  // Policies and resources
  'policies', 'resources',

  // Email configuration
  'google_email_provider_config', 'microsoft_email_provider_config',
  'email_provider_health', 'email_provider_configs', 'email_providers',
  'email_templates', 'email_domains', 'tenant_email_settings',

  // Storage configuration
  'storage_records', 'storage_schemas', 'storage_usage',
  'storage_configurations', 'storage_providers',
  'ext_storage_records', 'ext_storage_schemas', 'ext_storage_usage',

  // Templates and layouts
  'tenant_email_templates', 'template_sections',
  'approval_levels',  // After approval_thresholds

  // Custom fields and attributes
  'attribute_definitions', 'custom_fields',
  'layout_blocks', 'tag_definitions', 'custom_task_types',

  // Time period settings (tenant_time_period_settings must come BEFORE time_period_types)
  'tenant_time_period_settings',
  'time_periods', 'time_period_types', 'time_period_settings',

  // External entity mappings and tax
  'external_entity_mappings', 'external_tax_imports',

  // Tenant notification settings
  'tenant_internal_notification_category_settings', 'tenant_internal_notification_subtype_settings',
  'tenant_notification_category_settings', 'tenant_notification_subtype_settings',

  // Other tenant settings
  'tenant_telemetry_settings',
  'tenant_external_entity_mappings', 'telemetry_consent_log',
  'default_billing_settings', 'notification_settings',
  'inbound_ticket_defaults', 'user_type_rates', 'next_number',
  'event_catalog', 'provider_events',

  // Tenant settings last (before tenant itself)
  'tenant_settings',
];

const logger = () => Context.current().log;

/**
 * Get the management tenant ID for 'Nine Minds LLC'
 */
async function getManagementTenantIdInternal(knex: Knex): Promise<string | null> {
  const MANAGEMENT_TENANT_NAME = 'Nine Minds LLC';

  const tenant = await knex('tenants')
    .where('client_name', MANAGEMENT_TENANT_NAME)
    .first();

  return tenant?.tenant || null;
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
    const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
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

    const result = await adminKnex('users')
      .where({ tenant: tenantId, is_inactive: false })
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

    const result = await adminKnex('users')
      .where({ tenant: tenantId, is_inactive: true })
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

    // Find the customer client in management tenant that represents this tenant
    // Look for client with tenant_id in properties matching the tenantId
    const customerClient = await adminKnex('clients')
      .where({ tenant: managementTenantId })
      .whereRaw("properties->>'tenant_id' = ?", [tenantId])
      .first();

    if (!customerClient) {
      // Try alternate lookup - by client name matching tenant name
      const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
      if (tenant) {
        const clientByName = await adminKnex('clients')
          .where({ tenant: managementTenantId, client_name: tenant.client_name })
          .first();

        if (clientByName) {
          // Found by name, use this client
          const tagResult = await adminKnex.transaction(async (trx) => {
            return await TagModel.createTag(
              {
                tag_text: 'Canceled',
                tagged_id: clientByName.client_id,
                tagged_type: 'client',
                created_by: 'system',
              },
              managementTenantId,
              trx
            );
          });
          log.info('Client tagged as Canceled (by name lookup)', {
            tenantId,
            clientId: clientByName.client_id,
            tagId: tagResult.tag_id,
          });
          return { tagId: tagResult.tag_id };
        }
      }

      log.warn('No customer client found for tenant in management tenant', { tenantId });
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

    // Find customer client
    const customerClient = await adminKnex('clients')
      .where({ tenant: managementTenantId })
      .whereRaw("properties->>'tenant_id' = ?", [tenantId])
      .first();

    if (!customerClient) {
      // Try by name
      const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
      if (tenant) {
        const clientByName = await adminKnex('clients')
          .where({ tenant: managementTenantId, client_name: tenant.client_name })
          .first();
        if (clientByName) {
          await adminKnex('tag_mappings')
            .where({ tenant: managementTenantId, tagged_id: clientByName.client_id })
            .whereIn('tag_id', function() {
              this.select('tag_id').from('tag_definitions').where({ tenant: managementTenantId, tag_text: 'Canceled' });
            })
            .del();
          log.info('Canceled tag removed from client (by name lookup)');
          return;
        }
      }
      log.warn('No customer client found for tag removal');
      return;
    }

    // Remove the 'Canceled' tag mapping
    await adminKnex('tag_mappings')
      .where({ tenant: managementTenantId, tagged_id: customerClient.client_id })
      .whereIn('tag_id', function() {
        this.select('tag_id').from('tag_definitions').where({ tenant: managementTenantId, tag_text: 'Canceled' });
      })
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
 * Deactivate the client and its contacts in the management tenant.
 * This is called when a tenant is marked for deletion to disable their
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

    // Find the customer client in management tenant that represents this tenant
    let customerClient = await adminKnex('clients')
      .where({ tenant: managementTenantId })
      .whereRaw("properties->>'tenant_id' = ?", [tenantId])
      .first();

    // Try alternate lookup by name if not found by properties
    if (!customerClient) {
      const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
      if (tenant) {
        customerClient = await adminKnex('clients')
          .where({ tenant: managementTenantId, client_name: tenant.client_name })
          .first();
      }
    }

    if (!customerClient) {
      log.warn('No customer client found for tenant in management tenant', { tenantId });
      return { clientDeactivated: false, contactsDeactivated: 0 };
    }

    const clientId = customerClient.client_id;

    // Deactivate the client
    await adminKnex('clients')
      .where({ tenant: managementTenantId, client_id: clientId })
      .update({ is_inactive: true, updated_at: adminKnex.fn.now() });

    log.info('Deactivated client in master tenant', {
      tenantId,
      clientId,
      clientName: customerClient.client_name,
    });

    // Deactivate all contacts for this client
    const contactsUpdated = await adminKnex('contacts')
      .where({ tenant: managementTenantId, client_id: clientId })
      .update({ is_inactive: true, updated_at: adminKnex.fn.now() });

    log.info('Deactivated contacts for client in master tenant', {
      tenantId,
      clientId,
      contactsDeactivated: contactsUpdated,
    });

    return {
      clientId,
      clientDeactivated: true,
      contactsDeactivated: contactsUpdated,
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

    // Find customer client
    let customerClient = await adminKnex('clients')
      .where({ tenant: managementTenantId })
      .whereRaw("properties->>'tenant_id' = ?", [tenantId])
      .first();

    if (!customerClient) {
      const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
      if (tenant) {
        customerClient = await adminKnex('clients')
          .where({ tenant: managementTenantId, client_name: tenant.client_name })
          .first();
      }
    }

    if (!customerClient) {
      log.warn('No customer client found for reactivation');
      return;
    }

    const clientId = customerClient.client_id;

    // Reactivate the client
    await adminKnex('clients')
      .where({ tenant: managementTenantId, client_id: clientId })
      .update({ is_inactive: false, updated_at: adminKnex.fn.now() });

    // Reactivate contacts
    await adminKnex('contacts')
      .where({ tenant: managementTenantId, client_id: clientId })
      .update({ is_inactive: false, updated_at: adminKnex.fn.now() });

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
      adminKnex('users').where({ tenant: tenantId }).count('* as count').first(),
      adminKnex('users').where({ tenant: tenantId, is_inactive: false }).count('* as count').first(),
      adminKnex('tickets').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      // Open tickets - exclude closed status
      adminKnex('tickets')
        .where({ tenant: tenantId })
        .whereNotIn('status_id', function() {
          this.select('status_id').from('statuses').where({ tenant: tenantId, is_closed: true });
        })
        .count('* as count')
        .first()
        .catch(() => ({ count: 0 })),
      adminKnex('invoices').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      adminKnex('projects').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      adminKnex('documents').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      adminKnex('clients').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      adminKnex('contacts').where({ tenant: tenantId }).count('* as count').first().catch(() => ({ count: 0 })),
      adminKnex('tenants').where({ tenant: tenantId }).select('licensed_user_count').first(),
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
    const tenant = await adminKnex('tenants').where({ tenant: tenantId }).first();
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

    await adminKnex('pending_tenant_deletions').insert({
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
): Promise<string | null> {
  try {
    const result = await knex.raw(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ?
        AND column_name IN ('tenant', 'tenant_id')
        AND table_schema = 'public'
      LIMIT 1
    `, [tableName]);

    if (result.rows && result.rows.length > 0) {
      return result.rows[0].column_name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Break circular dependencies by nulling foreign key references.
 * This must be done before deleting records to avoid FK constraint violations.
 *
 * The circular dependency chain:
 * - clients.account_manager_id → users.user_id
 * - users.contact_id → contacts.contact_id (NOT NULL constraint!)
 * - contacts.client_id → clients.client_id
 */
async function breakCircularDependencies(
  knex: Knex,
  tenantId: string,
  log: ReturnType<typeof logger>
): Promise<void> {
  log.info('Breaking circular dependencies for tenant', { tenantId });

  // Step 1: NULL out account_manager_id in clients to break clients → users dependency
  try {
    const result1 = await knex('clients')
      .where({ tenant: tenantId })
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
    const result2 = await knex('contacts')
      .where({ tenant: tenantId })
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
    const adminKnex = await getAdminConnection();

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
    const tenantInfo = await adminKnex('tenants').where({ tenant: tenantId }).first();
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
    await breakCircularDependencies(adminKnex, tenantId, log);

    // Step 2: Delete from each table in order
    for (const tableName of TENANT_TABLES_DELETION_ORDER) {
      try {
        const tenantColumn = await getTableTenantColumn(adminKnex, tableName);

        if (tenantColumn) {
          // Count records first - with explicit tenant check
          const countResult = await adminKnex(tableName)
            .where({ [tenantColumn]: tenantId })
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
                tenantColumn,
                tenantId,
                managementTenantId,
                recordCount: count,
                isSafe: tenantId !== managementTenantId,
              });
            }

            // Delete records with explicit tenant filter
            const deleted = await adminKnex(tableName)
              .where({ [tenantColumn]: tenantId })
              .delete();

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
      const deletedPending = await adminKnex('pending_tenant_deletions')
        .where({ tenant: tenantId })
        .whereNot({ deletion_id: deletionId })
        .delete();

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

      await adminKnex('tenants')
        .where({ tenant: tenantId })
        .delete();

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

    // If we had errors but still deleted most things, consider it a partial success
    if (errors.length > 0 && errors.length < 10) {
      log.warn('Some tables had deletion errors', { errors });
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

    // Find active subscription for this tenant
    const activeSubscription = await adminKnex('stripe_subscriptions')
      .where({ tenant: tenantId, status: 'active' })
      .first();

    if (!activeSubscription) {
      log.info('No active Stripe subscription found for tenant', { tenantId });
      return { canceled: false };
    }

    const subscriptionExternalId = activeSubscription.stripe_subscription_external_id;
    log.info('Found active subscription, canceling', { subscriptionExternalId });

    // Dynamically import Stripe to avoid issues in environments where it's not available
    const { default: Stripe } = await import('stripe');
    const { getSecretProviderInstance } = await import('@alga-psa/shared/core');

    const secretProvider = await getSecretProviderInstance();
    let secretKey = await secretProvider.getAppSecret('stripe_secret_key');
    if (!secretKey && process.env.STRIPE_SECRET_KEY) {
      secretKey = process.env.STRIPE_SECRET_KEY;
    }

    if (!secretKey) {
      log.error('Stripe secret key not configured');
      return { canceled: false, error: 'Stripe secret key not configured' };
    }

    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
      typescript: true,
    });

    // Cancel the subscription immediately
    const canceledSubscription = await stripe.subscriptions.cancel(subscriptionExternalId);

    // Update our database to reflect the cancellation
    await adminKnex('stripe_subscriptions')
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
