/**
 * Migration: Create RMM Integration Tables
 *
 * This migration creates the foundational tables for RMM (Remote Monitoring and Management)
 * integrations, starting with NinjaOne support. It includes:
 * - rmm_integrations: Stores tenant-level RMM connection credentials and settings
 * - rmm_organization_mappings: Maps RMM organizations to Alga companies
 * - rmm_alerts: Stores synced alerts from RMM systems
 * - rmm_alert_rules: Configures how alerts map to ticket creation
 *
 * Also adds RMM-specific fields to existing asset tables.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Create rmm_integrations table
    await knex.schema.createTable('rmm_integrations', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('integration_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.string('provider', 50).notNullable(); // 'ninjaone', future: 'datto', 'connectwise_automate', etc.
        table.string('instance_url', 255).nullable(); // e.g., 'app.ninjarmm.com' or region-specific URL
        table.boolean('is_active').notNullable().defaultTo(false);
        table.timestamp('connected_at', { useTz: true }).nullable();
        table.timestamp('last_sync_at', { useTz: true }).nullable();
        table.timestamp('last_full_sync_at', { useTz: true }).nullable();
        table.timestamp('last_incremental_sync_at', { useTz: true }).nullable();
        table.string('sync_status', 20).nullable().defaultTo('pending'); // 'pending', 'syncing', 'completed', 'error'
        table.text('sync_error').nullable();
        table.jsonb('settings').defaultTo('{}'); // Provider-specific settings (sync intervals, webhook config, etc.)
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'integration_id']);
        table.unique(['tenant', 'provider'], { indexName: 'idx_rmm_integrations_tenant_provider' });
        table.index(['tenant', 'is_active'], 'idx_rmm_integrations_tenant_active');
    });

    // Create rmm_organization_mappings table
    await knex.schema.createTable('rmm_organization_mappings', table => {
        table.uuid('tenant').notNullable();
        table.uuid('mapping_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('integration_id').notNullable();
        table.string('external_organization_id', 255).notNullable(); // NinjaOne organization ID
        table.string('external_organization_name', 255).nullable();
        table.uuid('client_id').nullable(); // NULL if not yet mapped to an Alga client
        table.boolean('auto_sync_assets').notNullable().defaultTo(true);
        table.boolean('auto_create_tickets').notNullable().defaultTo(false);
        table.jsonb('metadata').defaultTo('{}'); // Additional org data from RMM
        table.timestamp('last_synced_at', { useTz: true }).nullable();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'mapping_id']);
        table.foreign(['tenant', 'integration_id']).references(['tenant', 'integration_id']).inTable('rmm_integrations').onDelete('CASCADE');
        table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('SET NULL');
        table.unique(['tenant', 'integration_id', 'external_organization_id'], { indexName: 'idx_rmm_org_mappings_unique_external' });
        table.index(['tenant', 'client_id'], 'idx_rmm_org_mappings_client');
    });

    // Create rmm_alerts table
    await knex.schema.createTable('rmm_alerts', table => {
        table.uuid('tenant').notNullable();
        table.uuid('alert_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('integration_id').notNullable();
        table.string('external_alert_id', 255).notNullable(); // NinjaOne alert UID
        table.string('external_device_id', 255).nullable(); // NinjaOne device ID
        table.uuid('asset_id').nullable(); // Linked Alga asset if mapped
        table.string('severity', 20).notNullable(); // 'critical', 'major', 'moderate', 'minor', 'none'
        table.string('priority', 20).nullable(); // 'critical', 'high', 'medium', 'low', 'none'
        table.string('status', 20).notNullable().defaultTo('active'); // 'active', 'acknowledged', 'resolved', 'auto_resolved'
        table.string('source_type', 50).nullable(); // 'condition', 'script', 'antivirus', etc.
        table.string('alert_class', 100).nullable(); // Alert classification from RMM
        table.text('message').nullable();
        table.text('device_name').nullable();
        table.uuid('ticket_id').nullable(); // Linked Alga ticket if created
        table.timestamp('triggered_at', { useTz: true }).nullable();
        table.timestamp('resolved_at', { useTz: true }).nullable();
        table.jsonb('metadata').defaultTo('{}'); // Full alert data from RMM
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'alert_id']);
        table.foreign(['tenant', 'integration_id']).references(['tenant', 'integration_id']).inTable('rmm_integrations').onDelete('CASCADE');
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('SET NULL');
        // Note: ticket_id FK will be added separately if tickets table uses different structure
        table.unique(['tenant', 'integration_id', 'external_alert_id'], { indexName: 'idx_rmm_alerts_unique_external' });
        table.index(['tenant', 'status'], 'idx_rmm_alerts_status');
        table.index(['tenant', 'severity'], 'idx_rmm_alerts_severity');
        table.index(['tenant', 'asset_id'], 'idx_rmm_alerts_asset');
        table.index(['tenant', 'triggered_at'], 'idx_rmm_alerts_triggered');
    });

    // Create rmm_alert_rules table
    await knex.schema.createTable('rmm_alert_rules', table => {
        table.uuid('tenant').notNullable();
        table.uuid('rule_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.uuid('integration_id').notNullable();
        table.string('name', 255).notNullable();
        table.text('description').nullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        table.integer('priority_order').notNullable().defaultTo(0); // Lower = higher priority for rule matching

        // Matching conditions (all conditions must match for rule to apply)
        table.specificType('severity_filter', 'text[]').nullable(); // Match these severities
        table.specificType('source_type_filter', 'text[]').nullable(); // Match these source types
        table.specificType('alert_class_filter', 'text[]').nullable(); // Match these alert classes
        table.specificType('organization_filter', 'text[]').nullable(); // Match these external org IDs
        table.text('message_pattern').nullable(); // Regex pattern to match alert message

        // Actions when rule matches
        table.boolean('create_ticket').notNullable().defaultTo(true);
        table.uuid('ticket_channel_id').nullable(); // Default channel for created tickets
        table.string('ticket_priority', 20).nullable(); // Override priority for created tickets
        table.uuid('assigned_user_id').nullable(); // Auto-assign to this user
        table.jsonb('ticket_template').defaultTo('{}'); // Template for ticket title/description
        table.boolean('auto_resolve_ticket').notNullable().defaultTo(false); // Auto-resolve ticket when alert resolves

        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'rule_id']);
        table.foreign(['tenant', 'integration_id']).references(['tenant', 'integration_id']).inTable('rmm_integrations').onDelete('CASCADE');
        table.index(['tenant', 'integration_id', 'is_active', 'priority_order'], 'idx_rmm_alert_rules_active_priority');
    });

    // Add RMM-specific fields to assets table
    await knex.schema.alterTable('assets', table => {
        table.string('rmm_provider', 50).nullable(); // 'ninjaone', etc.
        table.string('rmm_device_id', 255).nullable(); // External device ID
        table.string('rmm_organization_id', 255).nullable(); // External organization ID
        table.string('agent_status', 20).nullable(); // 'online', 'offline', 'unknown'
        table.timestamp('last_seen_at', { useTz: true }).nullable();
        table.timestamp('last_rmm_sync_at', { useTz: true }).nullable();

        table.index(['tenant', 'rmm_provider', 'rmm_device_id'], 'idx_assets_rmm_device');
        table.index(['tenant', 'agent_status'], 'idx_assets_agent_status');
    });

    // Add RMM-specific fields to workstation_assets table
    await knex.schema.alterTable('workstation_assets', table => {
        table.string('agent_version').nullable();
        table.string('antivirus_status', 50).nullable(); // 'protected', 'at_risk', 'unknown'
        table.string('antivirus_product').nullable();
        table.timestamp('last_reboot_at', { useTz: true }).nullable();
        table.integer('pending_patches').nullable();
        table.integer('failed_patches').nullable();
        table.timestamp('last_patch_scan_at', { useTz: true }).nullable();
        table.jsonb('system_info').defaultTo('{}'); // Additional system details from RMM
    });

    // Add RMM-specific fields to server_assets table
    await knex.schema.alterTable('server_assets', table => {
        table.string('agent_version').nullable();
        table.string('antivirus_status', 50).nullable();
        table.string('antivirus_product').nullable();
        table.timestamp('last_reboot_at', { useTz: true }).nullable();
        table.integer('pending_patches').nullable();
        table.integer('failed_patches').nullable();
        table.timestamp('last_patch_scan_at', { useTz: true }).nullable();
        table.jsonb('system_info').defaultTo('{}');
        table.jsonb('disk_usage').defaultTo('[]'); // Array of disk usage stats
        table.decimal('cpu_usage_percent', 5, 2).nullable();
        table.decimal('memory_usage_percent', 5, 2).nullable();
    });

    // Note: RLS is not used in this codebase. Tenant isolation is enforced
    // at the application layer via explicit tenant filtering in queries.
    // See docs/AI_coding_standards.md for the createTenantKnex() pattern.

    // Create updated_at triggers
    await knex.raw(`
        CREATE TRIGGER set_timestamp_rmm_integrations
        BEFORE UPDATE ON rmm_integrations
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();

        CREATE TRIGGER set_timestamp_rmm_organization_mappings
        BEFORE UPDATE ON rmm_organization_mappings
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();

        CREATE TRIGGER set_timestamp_rmm_alerts
        BEFORE UPDATE ON rmm_alerts
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();

        CREATE TRIGGER set_timestamp_rmm_alert_rules
        BEFORE UPDATE ON rmm_alert_rules
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Drop triggers
    await knex.raw(`
        DROP TRIGGER IF EXISTS set_timestamp_rmm_alert_rules ON rmm_alert_rules;
        DROP TRIGGER IF EXISTS set_timestamp_rmm_alerts ON rmm_alerts;
        DROP TRIGGER IF EXISTS set_timestamp_rmm_organization_mappings ON rmm_organization_mappings;
        DROP TRIGGER IF EXISTS set_timestamp_rmm_integrations ON rmm_integrations;
    `);

    // Remove RMM fields from server_assets
    await knex.schema.alterTable('server_assets', table => {
        table.dropColumn('memory_usage_percent');
        table.dropColumn('cpu_usage_percent');
        table.dropColumn('disk_usage');
        table.dropColumn('system_info');
        table.dropColumn('last_patch_scan_at');
        table.dropColumn('failed_patches');
        table.dropColumn('pending_patches');
        table.dropColumn('last_reboot_at');
        table.dropColumn('antivirus_product');
        table.dropColumn('antivirus_status');
        table.dropColumn('agent_version');
    });

    // Remove RMM fields from workstation_assets
    await knex.schema.alterTable('workstation_assets', table => {
        table.dropColumn('system_info');
        table.dropColumn('last_patch_scan_at');
        table.dropColumn('failed_patches');
        table.dropColumn('pending_patches');
        table.dropColumn('last_reboot_at');
        table.dropColumn('antivirus_product');
        table.dropColumn('antivirus_status');
        table.dropColumn('agent_version');
    });

    // Remove RMM fields from assets
    await knex.schema.alterTable('assets', table => {
        table.dropIndex(['tenant', 'agent_status'], 'idx_assets_agent_status');
        table.dropIndex(['tenant', 'rmm_provider', 'rmm_device_id'], 'idx_assets_rmm_device');
        table.dropColumn('last_rmm_sync_at');
        table.dropColumn('last_seen_at');
        table.dropColumn('agent_status');
        table.dropColumn('rmm_organization_id');
        table.dropColumn('rmm_device_id');
        table.dropColumn('rmm_provider');
    });

    // Drop tables in reverse order of creation
    await knex.schema
        .dropTableIfExists('rmm_alert_rules')
        .dropTableIfExists('rmm_alerts')
        .dropTableIfExists('rmm_organization_mappings')
        .dropTableIfExists('rmm_integrations');
};
