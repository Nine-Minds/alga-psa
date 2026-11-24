/** @param { import("knex").Knex } knex */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('imap_email_provider_config', 'oauth_reauthorization_required');
  if (!hasColumn) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.boolean('oauth_reauthorization_required').notNullable().defaultTo(false);
    });
  }

  let batch;
  do {
    batch = await knex('imap_email_provider_config')
      .whereNotNull('oauth_token_url')
      .whereNotNull('oauth_credentials_token_url')
      .whereRaw('oauth_credentials_token_url <> oauth_token_url')
      .where('oauth_reauthorization_required', false)
      .select('tenant', 'email_provider_id')
      .orderBy(['tenant', 'email_provider_id'])
      .limit(500);
    if (batch.length) {
      await knex('imap_email_provider_config')
        .whereIn(['tenant', 'email_provider_id'], batch.map(row => [row.tenant, row.email_provider_id]))
        .update({ oauth_reauthorization_required: true });
    }
  } while (batch.length === 500);
};

/** @param { import("knex").Knex } knex */
exports.down = async function(knex) {
  if (await knex.schema.hasColumn('imap_email_provider_config', 'oauth_reauthorization_required')) {
    await knex.schema.alterTable('imap_email_provider_config', (table) => {
      table.dropColumn('oauth_reauthorization_required');
    });
  }
};
