/**
 * Create vendor-specific calendar configuration tables
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tables = [
    {
      name: 'google_calendar_provider_config',
      build: (table) => {
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
      },
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_google_calendar_config_tenant
           ON google_calendar_provider_config (tenant)`,
        `CREATE INDEX IF NOT EXISTS idx_google_calendar_config_tenant_provider
           ON google_calendar_provider_config (tenant, calendar_provider_id)`,
        `CREATE INDEX IF NOT EXISTS idx_google_calendar_config_subscription
           ON google_calendar_provider_config (pubsub_subscription_name)`
      ],
    },
    {
      name: 'microsoft_calendar_provider_config',
      build: (table) => {
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
      },
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_config_tenant
           ON microsoft_calendar_provider_config (tenant)`,
        `CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_config_tenant_provider
           ON microsoft_calendar_provider_config (tenant, calendar_provider_id)`,
        `CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_config_subscription
           ON microsoft_calendar_provider_config (webhook_subscription_id)`
      ],
    },
  ];

  for (const { name, build, indexes } of tables) {
    const exists = await knex.schema.hasTable(name);
    if (!exists) {
      await knex.schema.createTable(name, build);
    }

    for (const indexSql of indexes) {
      await knex.raw(indexSql);
    }
  }

  const createDistributedFn = await knex
    .raw(
      `
      SELECT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'create_distributed_table'
      ) AS exists;
    `
    )
    .then((result) => result.rows?.[0]?.exists)
    .catch(() => false);

  if (createDistributedFn) {
    for (const { name } of tables) {
      const alreadyDistributed = await knex
        .raw(
          `
          SELECT 1
          FROM pg_dist_partition
          WHERE logicalrelid = ?::regclass
        `,
          [name]
        )
        .then((result) => result.rowCount > 0)
        .catch(() => false);

      if (!alreadyDistributed) {
        await knex.raw(`SELECT create_distributed_table('${name}', 'tenant')`);
      }
    }
  } else {
    console.warn(
      '[create_calendar_vendor_config_tables] Skipping create_distributed_table (function unavailable)'
    );
  }

  console.log('✅ Ensured vendor-specific calendar configuration tables exist');
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
