/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // Add a unique constraint to the 'name' column
  return knex.schema.alterTable('system_workflow_registrations', function(table) {
    table.unique(['name'], { indexName: 'system_workflow_registrations_name_unique_idx' });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Remove the unique constraint from the 'name' column
  return knex.schema.alterTable('system_workflow_registrations', function(table) {
    table.dropUnique(['name'], 'system_workflow_registrations_name_unique_idx');
  });
};
