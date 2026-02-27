/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS tenant_isolation_policy ON document_folders;
    CREATE POLICY tenant_isolation_policy ON document_folders
      USING (tenant = current_setting('app.current_tenant')::uuid);

    DROP POLICY IF EXISTS tenant_isolation_insert_policy ON document_folders;
    CREATE POLICY tenant_isolation_insert_policy ON document_folders
      FOR INSERT WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    DROP POLICY IF EXISTS tenant_isolation_insert_policy ON document_folders;
    DROP POLICY IF EXISTS tenant_isolation_policy ON document_folders;
    ALTER TABLE document_folders DISABLE ROW LEVEL SECURITY;
  `);
};
