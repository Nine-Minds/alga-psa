const TABLE_NAME = 'user_auth_accounts';
const INDEX_NAME = 'idx_user_auth_accounts_tenant_provider_account';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);
  if (!exists) {
    return;
  }

  await knex.schema.raw(
    `CREATE INDEX IF NOT EXISTS ${INDEX_NAME}
     ON ${TABLE_NAME} (tenant, provider, provider_account_id)`
  );
};

exports.down = async function down(knex) {
  await knex.schema.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
};
