/**
 * Create vendor-specific calendar configuration tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create google_calendar_provider_config table
  await knex.schema.createTable('google_calendar_provider_config', function(table) {
    // Foreign key to calendar_providers
    table.uuid('calendar_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    
    // OAuth configuration
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable(); // Encrypted in practice
    table.string('project_id', 255).notNullable();
    table.text('redirect_uri').notNullable();
    
    // Pub/Sub configuration for push notifications
    table.string('pubsub_topic_name', 255).nullable();
    table.string('pubsub_subscription_name', 255).nullable();
    table.timestamp('pubsub_initialised_at').nullable();
    
    // Webhook configuration
    table.text('webhook_notification_url').nullable();
    table.text('webhook_verification_token').nullable();
    
    // Calendar configuration
    table.string('calendar_id', 255).notNullable(); // Google Calendar ID
    
    // OAuth tokens (encrypted in practice)
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key
    table.primary(['calendar_provider_id', 'tenant']);
    
    // Foreign keys removed - CitusDB does not support FK constraints between distributed tables
    // Referential integrity enforced in application logic instead
  });

  // Create microsoft_calendar_provider_config table
  await knex.schema.createTable('microsoft_calendar_provider_config', function(table) {
    // Foreign key to calendar_providers
    table.uuid('calendar_provider_id').notNullable();
    table.uuid('tenant').notNullable();
    
    // OAuth configuration
    table.string('client_id', 255).notNullable();
    table.text('client_secret').notNullable(); // Encrypted in practice
    table.string('tenant_id', 255).notNullable(); // Microsoft tenant ID
    table.text('redirect_uri').notNullable();
    
    // Webhook configuration
    table.string('webhook_subscription_id', 255).nullable();
    table.timestamp('webhook_expires_at').nullable();
    table.text('webhook_notification_url').nullable();
    table.text('webhook_verification_token').nullable();
    
    // Calendar configuration
    table.string('calendar_id', 255).notNullable(); // Outlook Calendar ID
    
    // OAuth tokens (encrypted in practice)
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Primary key
    table.primary(['calendar_provider_id', 'tenant']);
    
    // Foreign keys removed - CitusDB does not support FK constraints between distributed tables
    // Referential integrity enforced in application logic instead
  });

  // Create indexes
  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_tenant 
    ON google_calendar_provider_config (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_tenant
    ON microsoft_calendar_provider_config (tenant)
  `);

  // Create compound indexes for typical lookup paths
  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_tenant_provider
    ON google_calendar_provider_config (tenant, calendar_provider_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_tenant_provider
    ON microsoft_calendar_provider_config (tenant, calendar_provider_id)
  `);

  // Create indexes for webhook lookups
  await knex.schema.raw(`
    CREATE INDEX idx_google_calendar_config_subscription
    ON google_calendar_provider_config (pubsub_subscription_name)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_microsoft_calendar_config_subscription
    ON microsoft_calendar_provider_config (webhook_subscription_id)
  `);

  // Check if Citus is enabled
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('google_calendar_provider_config', 'tenant')");
    await knex.raw("SELECT create_distributed_table('microsoft_calendar_provider_config', 'tenant')");
  } else {
    console.warn('[create_calendar_vendor_config_tables] Skipping create_distributed_table (function unavailable)');
  }

  console.log('✅ Created vendor-specific calendar configuration tables');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('google_calendar_provider_config');
  await knex.schema.dropTableIfExists('microsoft_calendar_provider_config');
  console.log('✅ Dropped vendor-specific calendar configuration tables');
};

// Disable transaction for Citus DB compatibility
// create_distributed_table cannot run inside a transaction block
exports.config = { transaction: false };

