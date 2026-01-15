/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('imap_email_provider_config', 'folder_state');
  if (!hasColumn) {
    await knex.schema.alterTable('imap_email_provider_config', function(table) {
      table.jsonb('folder_state').defaultTo('{}');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('imap_email_provider_config', 'folder_state');
  if (hasColumn) {
    await knex.schema.alterTable('imap_email_provider_config', function(table) {
      table.dropColumn('folder_state');
    });
  }
};
