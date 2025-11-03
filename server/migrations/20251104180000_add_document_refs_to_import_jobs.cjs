/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('import_jobs', (table) => {
    table.uuid('source_file_id').nullable();
    table.uuid('source_document_id').nullable();
    table.uuid('source_document_association_id').nullable();
  });

  await knex.schema.alterTable('import_jobs', (table) => {
    table
      .foreign(['tenant', 'source_file_id'], 'import_jobs_source_file_foreign')
      .references(['tenant', 'file_id'])
      .inTable('external_files')
      .onDelete('SET NULL');

    table
      .foreign(['tenant', 'source_document_id'], 'import_jobs_source_document_foreign')
      .references(['tenant', 'document_id'])
      .inTable('documents')
      .onDelete('SET NULL');

    table
      .foreign('source_document_association_id', 'import_jobs_source_doc_assoc_foreign')
      .references('association_id')
      .inTable('document_associations')
      .onDelete('SET NULL');

    table.index(['tenant', 'source_file_id'], 'import_jobs_source_file_idx');
    table.index(['tenant', 'source_document_id'], 'import_jobs_source_document_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('import_jobs', (table) => {
    table.dropIndex(['tenant', 'source_file_id'], 'import_jobs_source_file_idx');
    table.dropIndex(['tenant', 'source_document_id'], 'import_jobs_source_document_idx');

    table.dropForeign(['tenant', 'source_file_id'], 'import_jobs_source_file_foreign');
    table.dropForeign(['tenant', 'source_document_id'], 'import_jobs_source_document_foreign');
    table.dropForeign('source_document_association_id', 'import_jobs_source_doc_assoc_foreign');

    table.dropColumn('source_document_association_id');
    table.dropColumn('source_document_id');
    table.dropColumn('source_file_id');
  });
};
