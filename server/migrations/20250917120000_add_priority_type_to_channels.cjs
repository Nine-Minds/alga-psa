/**
 * Migration to add priority type configuration to channels
 * This allows channels to use either custom priorities or ITIL priorities (calculated from impact/urgency)
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('channels', function(table) {
    // Add priority type configuration
    table.enum('priority_type', ['custom', 'itil']).defaultTo('custom').comment('Type of priorities to use: custom or ITIL (impact/urgency based)');

    // Add index for performance
    table.index(['priority_type']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('channels', function(table) {
    // Drop index
    table.dropIndex(['priority_type']);

    // Drop column
    table.dropColumn('priority_type');
  });
};