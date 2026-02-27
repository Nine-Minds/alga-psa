/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn('document_folders', 'is_client_visible');
  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable('document_folders', (table) => {
    table.boolean('is_client_visible').notNullable().defaultTo(false);
  });
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

  const hasColumn = await knex.schema.hasColumn('document_folders', 'is_client_visible');
  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable('document_folders', (table) => {
    table.dropColumn('is_client_visible');
  });
};
