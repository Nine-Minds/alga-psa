/**
 * Align Google calendar provider vendor config with tenant-secret OAuth credentials
 * and add explicit webhook/channel columns for calendar change notifications.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('google_calendar_provider_config');
  if (!hasTable) return;

  await knex.schema.alterTable('google_calendar_provider_config', (table) => {
    table.string('client_id', 255).nullable().alter();
    table.text('client_secret').nullable().alter();
    table.string('project_id', 255).nullable().alter();
    table.text('redirect_uri').nullable().alter();

    // Google Calendar push channels (web_hook)
    // Keep names aligned with Microsoft where possible.
    table.string('webhook_subscription_id', 255).nullable();
    table.timestamp('webhook_expires_at').nullable();
    table.string('webhook_resource_id', 255).nullable();
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_google_calendar_config_webhook_subscription
    ON google_calendar_provider_config (webhook_subscription_id)
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('google_calendar_provider_config');
  if (!hasTable) return;

  await knex.schema.alterTable('google_calendar_provider_config', (table) => {
    table.dropColumn('webhook_subscription_id');
    table.dropColumn('webhook_expires_at');
    table.dropColumn('webhook_resource_id');

    table.string('client_id', 255).notNullable().alter();
    table.text('client_secret').notNullable().alter();
    table.string('project_id', 255).notNullable().alter();
    table.text('redirect_uri').notNullable().alter();
  });

  await knex.raw(`
    DROP INDEX IF EXISTS idx_google_calendar_config_webhook_subscription
  `);
};

exports.config = { transaction: false };

