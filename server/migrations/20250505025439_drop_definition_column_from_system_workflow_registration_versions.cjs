/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.table('system_workflow_registration_versions', function(table) {
    table.dropColumn('definition');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.table('system_workflow_registration_versions', function(table) {
    table.text('definition').nullable();
  });
};
