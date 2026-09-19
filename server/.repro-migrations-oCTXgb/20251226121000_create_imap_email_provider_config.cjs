/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('imap_email_provider_config', function(table) {
    table.uuid('email_provider_id').notNullable();
    table.uuid('tenant').notNullable();

    // Connection configuration
    table.string('host', 255).notNullable();
    table.integer('port').notNullable();
    table.boolean('secure').defaultTo(true);
    table.boolean('allow_starttls').defaultTo(false);
    table.string('auth_type', 50).notNullable(); // password | oauth2
    table.string('username', 255).notNullable();

    // Processing configuration
    table.boolean('auto_process_emails').defaultTo(true);
    table.integer('max_emails_per_sync').defaultTo(50);
    table.jsonb('folder_filters').defaultTo('[]');

    // OAuth configuration (if auth_type=oauth2)
    table.text('oauth_authorize_url').nullable();
    table.text('oauth_token_url').nullable();
    table.string('oauth_client_id', 255).nullable();
    table.text('oauth_client_secret').nullable();
    table.text('oauth_scopes').nullable();

    // OAuth tokens (encrypted in practice)
    table.text('access_token').nullable();
    table.text('refresh_token').nullable();
    table.timestamp('token_expires_at').nullable();

    // IMAP state tracking
    table.string('uid_validity', 255).nullable();
    table.string('last_uid', 255).nullable();
    table.timestamp('last_seen_at').nullable();
    table.timestamp('last_sync_at').nullable();
    table.text('last_error').nullable();

    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['email_provider_id', 'tenant']);
  });

  await knex.schema.raw(`
    CREATE INDEX idx_imap_email_config_tenant
    ON imap_email_provider_config (tenant)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_imap_email_config_tenant_provider
    ON imap_email_provider_config (tenant, email_provider_id)
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    await knex.raw("SELECT create_distributed_table('imap_email_provider_config', 'tenant')");
  } else {
    console.warn('[create_imap_email_provider_config] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('imap_email_provider_config');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
