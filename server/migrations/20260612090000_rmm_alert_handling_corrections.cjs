/**
 * Corrective migration for RMM alert handling.
 *
 * - rmm_alerts: adds the columns the alert pipeline writes (activity_type,
 *   acknowledgement fields) plus dedup/lifecycle state (dedup_key,
 *   occurrence_count, matched_rule_id, suppression linkage).
 * - rmm_alert_rules: replaces the flat filter/action columns with the JSONB
 *   conditions/actions model the rule evaluator uses.
 * - rmm_maintenance_windows: new table for alert suppression windows.
 *
 * The original 20251124000001 migration shipped with negligible data in these
 * tables, so the flat rule columns are dropped without backfill.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
    await knex.schema.alterTable('rmm_alerts', table => {
        table.string('activity_type', 100).nullable(); // RMM activity type (e.g., NinjaOne CONDITION)
        table.timestamp('acknowledged_at', { useTz: true }).nullable();
        table.uuid('acknowledged_by').nullable();
        table.string('dedup_key', 255).nullable(); // device + condition identity
        table.integer('occurrence_count').notNullable().defaultTo(1);
        table.timestamp('last_occurrence_at', { useTz: true }).nullable();
        table.uuid('matched_rule_id').nullable(); // rule that handled this alert
        table.boolean('auto_ticket_created').notNullable().defaultTo(false);
        table.uuid('suppressed_by_window_id').nullable(); // set when status = 'suppressed'

        table.index(['tenant', 'integration_id', 'dedup_key'], 'idx_rmm_alerts_dedup');
    });

    await knex.schema.alterTable('rmm_alert_rules', table => {
        table.jsonb('conditions').notNullable().defaultTo('{}');
        table.jsonb('actions').notNullable().defaultTo('{}');

        table.dropColumn('severity_filter');
        table.dropColumn('source_type_filter');
        table.dropColumn('alert_class_filter');
        table.dropColumn('organization_filter');
        table.dropColumn('message_pattern');
        table.dropColumn('create_ticket');
        table.dropColumn('ticket_channel_id');
        table.dropColumn('ticket_priority');
        table.dropColumn('assigned_user_id');
        table.dropColumn('ticket_template');
        table.dropColumn('auto_resolve_ticket');
    });

    await knex.schema.createTable('rmm_maintenance_windows', table => {
        table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
        table.uuid('window_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        // Optional scopes; null means the window applies to all of that dimension.
        table.uuid('integration_id').nullable();
        table.uuid('client_id').nullable();
        table.uuid('asset_id').nullable();
        table.string('name', 255).notNullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        // One-off windows use starts_at/ends_at; recurring windows use recurrence.
        table.timestamp('starts_at', { useTz: true }).nullable();
        table.timestamp('ends_at', { useTz: true }).nullable();
        table.jsonb('recurrence').nullable(); // { type: 'weekly', days, startTime, endTime, timezone }
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        table.primary(['tenant', 'window_id']);
        table.foreign(['tenant', 'integration_id']).references(['tenant', 'integration_id']).inTable('rmm_integrations').onDelete('CASCADE');
        table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
        table.foreign(['tenant', 'asset_id']).references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
        table.index(['tenant', 'is_active'], 'idx_rmm_maintenance_windows_active');
    });

    await knex.raw(`
        CREATE TRIGGER set_timestamp_rmm_maintenance_windows
        BEFORE UPDATE ON rmm_maintenance_windows
        FOR EACH ROW
        EXECUTE PROCEDURE on_update_timestamp();
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
    await knex.raw(`
        DROP TRIGGER IF EXISTS set_timestamp_rmm_maintenance_windows ON rmm_maintenance_windows;
    `);
    await knex.schema.dropTableIfExists('rmm_maintenance_windows');

    await knex.schema.alterTable('rmm_alert_rules', table => {
        table.dropColumn('conditions');
        table.dropColumn('actions');

        table.specificType('severity_filter', 'text[]').nullable();
        table.specificType('source_type_filter', 'text[]').nullable();
        table.specificType('alert_class_filter', 'text[]').nullable();
        table.specificType('organization_filter', 'text[]').nullable();
        table.text('message_pattern').nullable();
        table.boolean('create_ticket').notNullable().defaultTo(true);
        table.uuid('ticket_channel_id').nullable();
        table.string('ticket_priority', 20).nullable();
        table.uuid('assigned_user_id').nullable();
        table.jsonb('ticket_template').defaultTo('{}');
        table.boolean('auto_resolve_ticket').notNullable().defaultTo(false);
    });

    await knex.schema.alterTable('rmm_alerts', table => {
        table.dropIndex(['tenant', 'integration_id', 'dedup_key'], 'idx_rmm_alerts_dedup');
        table.dropColumn('suppressed_by_window_id');
        table.dropColumn('auto_ticket_created');
        table.dropColumn('matched_rule_id');
        table.dropColumn('last_occurrence_at');
        table.dropColumn('occurrence_count');
        table.dropColumn('dedup_key');
        table.dropColumn('acknowledged_by');
        table.dropColumn('acknowledged_at');
        table.dropColumn('activity_type');
    });
};
