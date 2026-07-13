'use strict';

/**
 * Tenant opportunity-discipline settings and per-opportunity episode markers.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('opportunity_settings', (table) => {
    table.uuid('tenant').notNullable().primary();
    table.integer('nudge_days').notNullable().defaultTo(14);
    table.integer('interrupt_days').notNullable().defaultTo(21);
    table.text('escalation_mode').notNullable().defaultTo('solo');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
  });

  await knex.raw(`
    ALTER TABLE opportunity_settings
    ADD CONSTRAINT opportunity_settings_thresholds_check
    CHECK (nudge_days >= 1 AND interrupt_days > nudge_days)
  `);
  await knex.raw(`
    ALTER TABLE opportunity_settings
    ADD CONSTRAINT opportunity_settings_escalation_mode_check
    CHECK (escalation_mode IN ('solo', 'team'))
  `);

  await knex.raw(`
    INSERT INTO opportunity_settings (tenant)
    SELECT tenant FROM tenants
    ON CONFLICT (tenant) DO NOTHING
  `);

  await knex.schema.alterTable('opportunities', (table) => {
    table.timestamp('last_nudged_at', { useTz: true }).nullable();
    table.timestamp('last_escalated_at', { useTz: true }).nullable();
    table.timestamp('overdue_notified_at', { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('opportunities', (table) => {
    table.dropColumn('overdue_notified_at');
    table.dropColumn('last_escalated_at');
    table.dropColumn('last_nudged_at');
  });
  await knex.schema.dropTableIfExists('opportunity_settings');
};
