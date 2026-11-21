/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const columnExists = await knex.schema.hasColumn('imap_email_provider_config', 'credential_generation');

  if (!columnExists) {
    await knex.schema.alterTable('imap_email_provider_config', function(table) {
      // NULL preserves access to legacy secret keys until the destination scope changes.
      table.uuid('credential_generation').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const columnExists = await knex.schema.hasColumn('imap_email_provider_config', 'credential_generation');

  if (columnExists) {
    await knex.schema.alterTable('imap_email_provider_config', function(table) {
      table.dropColumn('credential_generation');
    });
  }
};
