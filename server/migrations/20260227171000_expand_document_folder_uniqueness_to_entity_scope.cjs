/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    ALTER TABLE document_folders
    DROP CONSTRAINT IF EXISTS uq_document_folders_tenant_path;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS uq_document_folders_tenant_path;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folders_tenant_path_entity_scope
    ON document_folders (
      tenant,
      folder_path,
      COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(entity_type, '')
    );
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  await knex.raw(`
    DROP INDEX IF EXISTS uq_document_folders_tenant_path_entity_scope;
  `);

  const duplicatePaths = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM document_folders
      GROUP BY tenant, folder_path
      HAVING COUNT(*) > 1
    ) AS has_duplicates;
  `);

  if (duplicatePaths.rows?.[0]?.has_duplicates) {
    throw new Error(
      'Cannot rollback: duplicate (tenant, folder_path) rows exist due to entity-scoped folders. ' +
      'Remove entity-scoped duplicate rows before retrying rollback.'
    );
  }

  await knex.raw(`
    ALTER TABLE document_folders
    ADD CONSTRAINT uq_document_folders_tenant_path
    UNIQUE (tenant, folder_path);
  `);
};
