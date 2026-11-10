/** @param { import("knex").Knex } knex */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_reauthorization_required');
  if (!hasColumn) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.boolean('oauth_reauthorization_required').notNullable().defaultTo(false);
    });
  }

  await knex('imap_email_provider_config')
    .whereNotNull('oauth_token_url')
    .whereNotNull('oauth_credentials_token_url')
    .whereRaw('oauth_credentials_token_url <> oauth_token_url')
    .update({ oauth_reauthorization_required: true });
};

/** @param { import("knex").Knex } knex */
exports.down = async function(knex) {
  if (await knex.schema.hasColumn('imap_email_provider_config', 'oauth_reauthorization_required')) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.dropColumn('oauth_reauthorization_required');
    });
  }
};
