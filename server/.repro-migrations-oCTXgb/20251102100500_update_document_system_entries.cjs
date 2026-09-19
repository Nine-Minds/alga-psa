/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('document_system_entries');
  if (!hasTable) {
    return;
  }

  // Align tenant column expectations
  await knex.raw('ALTER TABLE document_system_entries ALTER COLUMN tenant DROP DEFAULT');

  // Re-create foreign key without cascading deletes (Citus compatible)
  await knex.raw(`
    ALTER TABLE document_system_entries
    DROP CONSTRAINT IF EXISTS document_system_entries_tenant_file_id_foreign
  `);
  await knex.raw(`
    ALTER TABLE document_system_entries
    ADD CONSTRAINT document_system_entries_tenant_file_id_foreign
      FOREIGN KEY (tenant, file_id)
      REFERENCES external_files (tenant, file_id)
  `);

  // Ensure indexes exist
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS document_system_entries_tenant_category_idx ON document_system_entries (tenant, category)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS document_system_entries_file_id_idx ON document_system_entries (file_id)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('document_system_entries');
  if (!hasTable) {
    return;
  }

  await knex.raw('DROP INDEX IF EXISTS document_system_entries_tenant_category_idx');
  await knex.raw('DROP INDEX IF EXISTS document_system_entries_file_id_idx');
};

