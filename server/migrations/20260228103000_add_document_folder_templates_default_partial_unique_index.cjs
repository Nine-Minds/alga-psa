/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('document_folder_templates');
  if (!hasTable) {
    return;
  }

  const hasEntityType = await knex.schema.hasColumn('document_folder_templates', 'entity_type');
  const hasIsDefault = await knex.schema.hasColumn('document_folder_templates', 'is_default');
  if (!hasEntityType || !hasIsDefault) {
    return;
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_folder_templates_default_per_entity_type
    ON document_folder_templates (tenant, entity_type)
    WHERE is_default = true
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_doc_folder_templates_default_per_entity_type');
};
