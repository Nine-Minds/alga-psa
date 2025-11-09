/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const addColumnIfMissing = async (column, builder) => {
    const exists = await knex.schema.hasColumn('import_jobs', column);
    if (!exists) {
      await knex.schema.alterTable('import_jobs', builder);
    }
  };

  await addColumnIfMissing('source_file_id', (table) => {
    table.uuid('source_file_id').nullable();
  });

  await addColumnIfMissing('source_document_id', (table) => {
    table.uuid('source_document_id').nullable();
  });

  await addColumnIfMissing('source_document_association_id', (table) => {
    table.uuid('source_document_association_id').nullable();
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'import_jobs_source_file_foreign'
          AND table_name = 'import_jobs'
      ) THEN
        ALTER TABLE import_jobs
          ADD CONSTRAINT import_jobs_source_file_foreign
          FOREIGN KEY (tenant, source_file_id)
          REFERENCES external_files (tenant, file_id)
          ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'import_jobs_source_document_foreign'
          AND table_name = 'import_jobs'
      ) THEN
        ALTER TABLE import_jobs
          ADD CONSTRAINT import_jobs_source_document_foreign
          FOREIGN KEY (tenant, source_document_id)
          REFERENCES documents (tenant, document_id)
          ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'import_jobs_source_doc_assoc_foreign'
          AND table_name = 'import_jobs'
      ) THEN
        ALTER TABLE import_jobs
          ADD CONSTRAINT import_jobs_source_doc_assoc_foreign
          FOREIGN KEY (source_document_association_id)
          REFERENCES document_associations (association_id)
          ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await knex.raw('CREATE INDEX IF NOT EXISTS import_jobs_source_file_idx ON import_jobs (tenant, source_file_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS import_jobs_source_document_idx ON import_jobs (tenant, source_document_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS import_jobs_source_doc_assoc_idx ON import_jobs (tenant, source_document_association_id)');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS import_jobs_source_file_idx');
  await knex.raw('DROP INDEX IF EXISTS import_jobs_source_document_idx');
  await knex.raw('DROP INDEX IF EXISTS import_jobs_source_doc_assoc_idx');

  await knex.raw('ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_file_foreign');
  await knex.raw('ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_document_foreign');
  await knex.raw('ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_doc_assoc_foreign');
  await knex.raw('ALTER TABLE document_associations DROP CONSTRAINT IF EXISTS document_associations_tenant_assoc_unique');

  const dropColumnIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('import_jobs', column);
    if (exists) {
      await knex.schema.alterTable('import_jobs', (table) => {
        table.dropColumn(column);
      });
    }
  };

  await dropColumnIfExists('source_document_association_id');
  await dropColumnIfExists('source_document_id');
  await dropColumnIfExists('source_file_id');
};
