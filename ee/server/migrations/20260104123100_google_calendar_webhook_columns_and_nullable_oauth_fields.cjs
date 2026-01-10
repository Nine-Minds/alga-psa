/**
 * Align Google calendar provider vendor config with tenant-secret OAuth credentials
 * and add explicit webhook/channel columns for calendar change notifications.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('google_calendar_provider_config');
  if (!hasTable) return;

  const addColumnIfMissing = async (tableName, columnName, columnBuilder) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (exists) return;

    await knex.schema.alterTable(tableName, (table) => {
      columnBuilder(table, columnName);
    });
  };

  const alterColumnNullableIfPresent = async (tableName, columnName, alterBuilder) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (!exists) return;

    await knex.schema.alterTable(tableName, (table) => {
      alterBuilder(table, columnName);
    });
  };

  await alterColumnNullableIfPresent('google_calendar_provider_config', 'client_id', (t, name) =>
    t.string(name, 255).nullable().alter()
  );
  await alterColumnNullableIfPresent('google_calendar_provider_config', 'client_secret', (t, name) =>
    t.text(name).nullable().alter()
  );
  await alterColumnNullableIfPresent('google_calendar_provider_config', 'project_id', (t, name) =>
    t.string(name, 255).nullable().alter()
  );
  await alterColumnNullableIfPresent('google_calendar_provider_config', 'redirect_uri', (t, name) =>
    t.text(name).nullable().alter()
  );

  // Google Calendar push channels (web_hook)
  await addColumnIfMissing('google_calendar_provider_config', 'webhook_subscription_id', (t, name) =>
    t.string(name, 255).nullable()
  );
  await addColumnIfMissing('google_calendar_provider_config', 'webhook_expires_at', (t, name) =>
    t.timestamp(name).nullable()
  );
  await addColumnIfMissing('google_calendar_provider_config', 'webhook_resource_id', (t, name) =>
    t.string(name, 255).nullable()
  );

  const hasWebhookSubscriptionId = await knex.schema.hasColumn(
    'google_calendar_provider_config',
    'webhook_subscription_id'
  );
  if (hasWebhookSubscriptionId) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_google_calendar_config_webhook_subscription
      ON google_calendar_provider_config (webhook_subscription_id)
    `);
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('google_calendar_provider_config');
  if (!hasTable) return;

  const dropColumnIfPresent = async (tableName, columnName) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (!exists) return;

    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn(columnName);
    });
  };

  await knex.raw(`
    DROP INDEX IF EXISTS idx_google_calendar_config_webhook_subscription
  `);

  await dropColumnIfPresent('google_calendar_provider_config', 'webhook_subscription_id');
  await dropColumnIfPresent('google_calendar_provider_config', 'webhook_expires_at');
  await dropColumnIfPresent('google_calendar_provider_config', 'webhook_resource_id');

  await knex.schema.alterTable('google_calendar_provider_config', (table) => {
    table.string('client_id', 255).notNullable().alter();
    table.text('client_secret').notNullable().alter();
    table.string('project_id', 255).notNullable().alter();
    table.text('redirect_uri').notNullable().alter();
  });

};

exports.config = { transaction: false };
