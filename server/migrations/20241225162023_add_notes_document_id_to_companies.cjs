/**
 * Add notes_document_id to companies table with proper foreign key constraint
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('companies', function(table) {
    // Add notes_document_id column
    table.uuid('notes_document_id').nullable();

    // Add composite foreign key constraint including tenant for proper multi-tenant isolation
    table
      .foreign(['tenant', 'notes_document_id'])
      .references(['tenant', 'document_id'])
      .inTable('documents')
      .onDelete('SET NULL');
  });
};

/**
 * Remove notes_document_id from companies table
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('companies', function(table) {
    // Drop the foreign key constraint first
    table.dropForeign(['tenant', 'notes_document_id']);
    // Then drop the column
    table.dropColumn('notes_document_id');
  });
};
