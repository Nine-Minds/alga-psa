/** @param { import("knex").Knex } knex */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_credentials_token_url');
  if (!hasColumn) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.text('oauth_credentials_token_url').nullable();
    });
    // Existing credentials are bound to their currently configured issuer.
    // Only backfill on first column creation: a retry must never rebind a
    // credential marker deliberately cleared by a later issuer change.
    await knex('imap_email_provider_config')
      .whereNotNull('oauth_token_url')
      .update({ oauth_credentials_token_url: knex.ref('oauth_token_url') });
  }
  const hasSecretVersion = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_credentials_secret_version');
  if (!hasSecretVersion) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.integer('oauth_credentials_secret_version').notNullable().defaultTo(0);
    });
  }

};

/** @param { import("knex").Knex } knex */
exports.down = async function(knex) {
  const hasBinding = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_credentials_token_url');
  const hasSecretVersion = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_credentials_secret_version');
  if (hasBinding || hasSecretVersion) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      if (hasBinding) table.dropColumn('oauth_credentials_token_url');
      if (hasSecretVersion) table.dropColumn('oauth_credentials_secret_version');
    });
  }
};
