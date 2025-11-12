/**
 * EE override that makes vendor-specific calendar configuration tables idempotent.
 * Base migrations already provision these tables; this version simply skips creation
 * when they exist so the migration chain completes on fresh installs.
 *
 * @param { import('knex').Knex } knex
 */

exports.config = { transaction: false };

async function ensureDistributed(knex, table) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (result.rows?.[0]?.exists) {
    await knex.raw(`SELECT create_distributed_table('${table}', 'tenant');`);
  }
}

async function createGoogleTable(knex) {
  const exists = await knex.schema.hasTable('google_calendar_provider_config');
  if (exists) {
    console.log('[google_calendar_provider_config] Table already exists, skipping');
    return false;
  }

  await knex.schema.createTable('google_calendar_provider_config', (table) => {
    table.uuid('calendar_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable();
    table.string('project_id', 255).notNullable();
    table.text('redirect_uri').notNullable();
    table.string('pubsub_topic_name', 255).nullable();
    table.string('pubsub_subscription_name', 255).nullable();
    table.timestamp('pubsub_initialised_at').nullable();
    table.text('webhook_notification_url').nullable();
    table.text('webhook_verification_token').nullable();
    table.string('calendar_id', 255).notNullable();
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['calendar_provider_id', 'tenant']);
  });

  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_tenant
    ON google_calendar_provider_config (tenant)
  `);
  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_tenant_provider
    ON google_calendar_provider_config (tenant, calendar_provider_id)
  `);
  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_subscription
    ON google_calendar_provider_config (pubsub_subscription_name)
  `);

  await ensureDistributed(knex, 'google_calendar_provider_config');
  console.log('[google_calendar_provider_config] Table created');
  return true;
}

async function createMicrosoftTable(knex) {
  const exists = await knex.schema.hasTable('microsoft_calendar_provider_config');
  if (exists) {
    console.log('[microsoft_calendar_provider_config] Table already exists, skipping');
    return false;
  }

  await knex.schema.createTable('microsoft_calendar_provider_config', (table) => {
    table.uuid('calendar_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable();
    table.string('tenant_id', 255).notNullable();
    table.text('redirect_uri').notNullable();
    table.string('webhook_subscription_id', 255).nullable();
    table.timestamp('webhook_expires_at').nullable();
    table.text('webhook_notification_url').nullable();
    table.text('webhook_verification_token').nullable();
    table.string('calendar_id', 255).notNullable();
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['calendar_provider_id', 'tenant']);
  });

  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_tenant
    ON microsoft_calendar_provider_config (tenant)
  `);
  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_tenant_provider
    ON microsoft_calendar_provider_config (tenant, calendar_provider_id)
  `);
  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_subscription
    ON microsoft_calendar_provider_config (webhook_subscription_id)
  `);

  await ensureDistributed(knex, 'microsoft_calendar_provider_config');
  console.log('[microsoft_calendar_provider_config] Table created');
  return true;
}

exports.up = async function up(knex) {
  const createdGoogle = await createGoogleTable(knex);
  const createdMicrosoft = await createMicrosoftTable(knex);

  if (!createdGoogle && !createdMicrosoft) {
    console.log('[calendar_vendor_config] Tables already in place; nothing to do');
  }
};

exports.down = async function down(knex) {
  const googleExists = await knex.schema.hasTable('google_calendar_provider_config');
  if (googleExists) {
    await knex.schema.dropTable('google_calendar_provider_config');
    console.log('[google_calendar_provider_config] Table dropped');
  }

  const msExists = await knex.schema.hasTable('microsoft_calendar_provider_config');
  if (msExists) {
    await knex.schema.dropTable('microsoft_calendar_provider_config');
    console.log('[microsoft_calendar_provider_config] Table dropped');
  }
};
