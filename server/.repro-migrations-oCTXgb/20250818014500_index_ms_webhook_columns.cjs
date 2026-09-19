/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_email_provider_config');
  if (!hasTable) return;

  // Add composite index to support tenant-scoped lookups by subscription id
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_ms_config_tenant_subscription
    ON microsoft_email_provider_config (tenant, webhook_subscription_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS idx_ms_config_tenant_subscription
  `);
};

