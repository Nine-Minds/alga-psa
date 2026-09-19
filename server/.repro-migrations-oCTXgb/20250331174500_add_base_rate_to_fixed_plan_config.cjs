/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('plan_service_fixed_config', function(table) {
    table.decimal('base_rate', 10, 2).nullable().comment('The base rate for fixed price plans');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('plan_service_fixed_config', function(table) {
    table.dropColumn('base_rate');
  });
};