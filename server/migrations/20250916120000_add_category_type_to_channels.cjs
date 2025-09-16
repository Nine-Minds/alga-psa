/**
 * Migration to add category type configuration to channels
 * This allows channels to use either custom categories or ITIL categories
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('channels', function(table) {
    // Add category type configuration
    table.enum('category_type', ['custom', 'itil']).defaultTo('custom').comment('Type of categories to use: custom or ITIL');

    // Add display configuration for ITIL-specific fields
    table.boolean('display_itil_impact').defaultTo(false).comment('Show ITIL Impact field in forms');
    table.boolean('display_itil_urgency').defaultTo(false).comment('Show ITIL Urgency field in forms');
    table.boolean('display_itil_category').defaultTo(false).comment('Show ITIL Category field in forms');

    // Add index for performance
    table.index(['category_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('channels', function(table) {
    // Drop index
    table.dropIndex(['category_type']);

    // Drop columns
    table.dropColumn('category_type');
    table.dropColumn('display_itil_impact');
    table.dropColumn('display_itil_urgency');
    table.dropColumn('display_itil_category');
  });
};