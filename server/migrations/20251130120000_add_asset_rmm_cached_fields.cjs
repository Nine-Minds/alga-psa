/**
 * Migration: Add RMM Cached Fields to Asset Extension Tables
 *
 * Adds fields to cache RMM live data in the database during sync, enabling:
 * - Instant page load (no external API calls on view)
 * - "As of last sync" display with manual refresh option
 * - Historical data even when RMM is unreachable
 *
 * Fields added to workstation_assets and server_assets:
 * - current_user: Currently logged-in user
 * - uptime_seconds: Device uptime
 * - lan_ip / wan_ip: Network addresses
 * - cpu_utilization_percent: CPU usage (workstation only, server already has cpu_usage_percent)
 * - memory_usage_percent: Memory usage (workstation only, server already has it)
 * - memory_used_gb: Absolute memory used
 * - disk_usage: Storage details array (workstation only, server already has it)
 * - pending_os_patches / pending_software_patches: Breakdown of patch types
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    // Add fields to workstation_assets
    await knex.schema.alterTable('workstation_assets', table => {
        // Live session data
        table.string('current_user', 255).nullable();
        table.bigInteger('uptime_seconds').nullable();

        // Network addresses
        table.string('lan_ip', 45).nullable(); // IPv6 max length is 45
        table.string('wan_ip', 45).nullable();

        // Resource utilization (server_assets already has cpu_usage_percent and memory_usage_percent)
        table.decimal('cpu_utilization_percent', 5, 2).nullable();
        table.decimal('memory_usage_percent', 5, 2).nullable();
        table.decimal('memory_used_gb', 10, 2).nullable();

        // Storage details (server_assets already has disk_usage)
        table.jsonb('disk_usage').defaultTo('[]');

        // Patch breakdown (more specific than existing pending_patches)
        table.integer('pending_os_patches').nullable();
        table.integer('pending_software_patches').nullable();
    });

    // Add fields to server_assets (some already exist from previous migration)
    await knex.schema.alterTable('server_assets', table => {
        // Live session data
        table.string('current_user', 255).nullable();
        table.bigInteger('uptime_seconds').nullable();

        // Network addresses
        table.string('lan_ip', 45).nullable();
        table.string('wan_ip', 45).nullable();

        // Memory used (server already has memory_usage_percent)
        table.decimal('memory_used_gb', 10, 2).nullable();

        // Patch breakdown
        table.integer('pending_os_patches').nullable();
        table.integer('pending_software_patches').nullable();

        // Software inventory (workstation already has installed_software)
        table.jsonb('installed_software').defaultTo('[]');
    });

    // Add indexes for common queries
    await knex.schema.alterTable('workstation_assets', table => {
        table.index(['tenant', 'current_user'], 'idx_workstation_assets_current_user');
    });

    await knex.schema.alterTable('server_assets', table => {
        table.index(['tenant', 'current_user'], 'idx_server_assets_current_user');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    // Remove indexes
    await knex.schema.alterTable('server_assets', table => {
        table.dropIndex(['tenant', 'current_user'], 'idx_server_assets_current_user');
    });

    await knex.schema.alterTable('workstation_assets', table => {
        table.dropIndex(['tenant', 'current_user'], 'idx_workstation_assets_current_user');
    });

    // Remove fields from server_assets
    await knex.schema.alterTable('server_assets', table => {
        table.dropColumn('installed_software');
        table.dropColumn('pending_software_patches');
        table.dropColumn('pending_os_patches');
        table.dropColumn('memory_used_gb');
        table.dropColumn('wan_ip');
        table.dropColumn('lan_ip');
        table.dropColumn('uptime_seconds');
        table.dropColumn('current_user');
    });

    // Remove fields from workstation_assets
    await knex.schema.alterTable('workstation_assets', table => {
        table.dropColumn('pending_software_patches');
        table.dropColumn('pending_os_patches');
        table.dropColumn('disk_usage');
        table.dropColumn('memory_used_gb');
        table.dropColumn('memory_usage_percent');
        table.dropColumn('cpu_utilization_percent');
        table.dropColumn('wan_ip');
        table.dropColumn('lan_ip');
        table.dropColumn('uptime_seconds');
        table.dropColumn('current_user');
    });
};
