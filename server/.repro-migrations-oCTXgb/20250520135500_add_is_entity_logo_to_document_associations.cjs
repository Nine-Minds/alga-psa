exports.up = async function(knex) {
  await knex.schema.alterTable('document_associations', (table) => {
    table.boolean('is_entity_logo').nullable().defaultTo(false)
      .comment('Indicates if this document serves as the primary logo/avatar for the associated entity.');
  });
  
  // Add a partial unique index using knex.raw for better control
  // This ensures only one document can be marked as the logo (is_entity_logo = TRUE) per entity.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_document_associations_single_true_logo
    ON document_associations (tenant, entity_id, entity_type)
    WHERE is_entity_logo = TRUE;
  `);
  // Note: The partial unique index is on (tenant, entity_id, entity_type) WHERE is_entity_logo = TRUE.
  // This allows many rows with is_entity_logo = FALSE (or NULL),
    // but only one row with is_entity_logo = TRUE for each combination of
    // tenant, entity_id, and entity_type.
};

exports.down = async function(knex) {
  // Drop the unique index using knex.raw
  await knex.raw('DROP INDEX IF EXISTS uq_document_associations_single_true_logo;');

  // Then alter the table to drop the column
  await knex.schema.alterTable('document_associations', (table) => {
    table.dropColumn('is_entity_logo');
  });
};
