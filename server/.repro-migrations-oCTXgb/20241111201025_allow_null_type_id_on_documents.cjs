/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('documents', table => {
      // Drop the foreign key constraint first
      table.dropForeign(['type_id', 'tenant'], 'documents_tenant_type_id_foreign');
    })
    .then(() => {
      return knex.schema.alterTable('documents', table => {
        // Modify type_id to allow null values
        table.uuid('type_id').nullable().alter();
      });
    })
    .then(() => {
      return knex.schema.alterTable('documents', table => {
        // Re-add the foreign key constraint
        table.foreign(['type_id', 'tenant'], 'documents_tenant_type_id_foreign')
          .references(['type_id', 'tenant'])
          .inTable('document_types')
          .onDelete('SET NULL');
      });
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .alterTable('documents', table => {
      // Drop the foreign key constraint first
      table.dropForeign(['type_id', 'tenant'], 'documents_tenant_type_id_foreign');
    })
    .then(() => {
      return knex.schema.alterTable('documents', table => {
        // Revert type_id back to not null
        table.uuid('type_id').notNullable().alter();
      });
    })
    .then(() => {
      return knex.schema.alterTable('documents', table => {
        // Re-add the foreign key constraint
        table.foreign(['type_id', 'tenant'], 'documents_tenant_type_id_foreign')
          .references(['type_id', 'tenant'])
          .inTable('document_types')
          .onDelete('SET NULL');
      });
    });
};
