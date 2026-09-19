/**
 * Remember which Microsoft profile issued an email provider's refresh token.
 * client_id remains the authoritative issuing-app pin for legacy rows.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  const hasProfileId = await knex.schema.hasColumn(
    'microsoft_email_provider_config',
    'microsoft_profile_id'
  );
  const hasSecretRef = await knex.schema.hasColumn(
    'microsoft_email_provider_config',
    'client_secret_ref'
  );

  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    if (!hasProfileId) table.uuid('microsoft_profile_id').nullable();
    if (!hasSecretRef) table.text('client_secret_ref').nullable();
  });
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  const hasProfileId = await knex.schema.hasColumn(
    'microsoft_email_provider_config',
    'microsoft_profile_id'
  );
  const hasSecretRef = await knex.schema.hasColumn(
    'microsoft_email_provider_config',
    'client_secret_ref'
  );

  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    if (hasProfileId) table.dropColumn('microsoft_profile_id');
    if (hasSecretRef) table.dropColumn('client_secret_ref');
  });
};
