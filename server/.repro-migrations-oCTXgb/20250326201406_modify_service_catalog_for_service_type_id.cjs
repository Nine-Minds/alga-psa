/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('service_catalog', function(table) {
    // Add the new foreign key column, initially nullable
    table.uuid('service_type_id').nullable().references('id').inTable('service_types').onDelete('SET NULL');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('service_catalog', function(table) {
    // Drop the foreign key constraint first (Knex might handle this implicitly, but explicit is safer)
    // Note: Constraint name might vary depending on DB/Knex version, adjust if needed.
    // Example constraint name format: service_catalog_service_type_id_foreign
    // It's often better to look up the constraint name if the down migration fails.
    // For now, we assume Knex handles dropping the constraint when dropping the column.
    table.dropColumn('service_type_id');
  });
};
