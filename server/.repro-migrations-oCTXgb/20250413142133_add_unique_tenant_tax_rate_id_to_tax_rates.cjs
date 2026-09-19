/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    // Add a unique constraint on the combination of tenant and tax_rate_id
    // This is required for the foreign key constraint in service_catalog
    table.unique(['tenant', 'tax_rate_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    // Drop the unique constraint added in the 'up' function
    // Note: Knex uses a default naming convention (tablename_columns_unique)
    // If this fails during rollback, the specific constraint name might need to be provided.
    table.dropUnique(['tenant', 'tax_rate_id']);
  });
};
