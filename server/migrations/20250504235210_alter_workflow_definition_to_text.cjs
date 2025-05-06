/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('system_workflow_registration_versions', function(table) {
    // Change the definition column to text
    // Using 'text' type is generally suitable for storing code or large strings
    table.text('definition').alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('system_workflow_registration_versions', function(table) {
    // Revert the definition column back to jsonb
    // Note: This might fail if data stored in 'text' is not valid JSON.
    // Consider data migration/validation if necessary before running down migration.
    table.jsonb('definition').alter();
  });
};
