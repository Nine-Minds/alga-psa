/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('documents');
  if (!hasTable) {
    return;
  }

  const hasVisibilityColumn = await knex.schema.hasColumn('documents', 'is_client_visible');
  if (!hasVisibilityColumn) {
    return;
  }

  // Plain index (no WHERE predicate) — partial indexes unsupported on CitusDB distributed tables
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_documents_tenant_client_visible_true
    ON documents (tenant, is_client_visible)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_documents_tenant_client_visible_true');
};
