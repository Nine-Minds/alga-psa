/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_email_provider_config');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('microsoft_email_provider_config', 'webhook_verification_token');
  if (!hasColumn) {
    await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
      table.text('webhook_verification_token');
    });
    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_ms_config_tenant_verification
      ON microsoft_email_provider_config (tenant, webhook_verification_token)
    `);
    console.log('✅ Added microsoft_email_provider_config.webhook_verification_token');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_email_provider_config');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('microsoft_email_provider_config', 'webhook_verification_token');
  if (hasColumn) {
    await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
      table.dropColumn('webhook_verification_token');
    });
  }
  await knex.schema.raw('DROP INDEX IF EXISTS idx_ms_config_tenant_verification');
};

