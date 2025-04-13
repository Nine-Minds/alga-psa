/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.withSchema('public').alterTable('plan_service_fixed_config', (table) => {
    // Remove the columns that are being moved to the new plan-level table
    table.dropColumn('enable_proration');
    table.dropColumn('billing_cycle_alignment');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.withSchema('public').alterTable('plan_service_fixed_config', (table) => {
    // Add the columns back with their original definitions for rollback
    table.boolean('enable_proration').notNullable().defaultTo(false);
    table.string('billing_cycle_alignment', 20).notNullable().defaultTo('start');
  });
};
