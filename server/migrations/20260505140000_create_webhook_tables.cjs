/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('webhooks', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('webhook_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('url').notNullable();
    table.text('method').notNullable().defaultTo('POST');
    table.specificType('event_types', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.jsonb('custom_headers');
    table.jsonb('event_filter');
    table.text('signing_secret_vault_path').notNullable();
    table.text('security_type').notNullable().defaultTo('hmac_signature');
    table.boolean('verify_ssl').notNullable().defaultTo(true);
    table.jsonb('retry_config');
    table.integer('rate_limit_per_min').notNullable().defaultTo(100);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('total_deliveries').notNullable().defaultTo(0);
    table.integer('successful_deliveries').notNullable().defaultTo(0);
    table.integer('failed_deliveries').notNullable().defaultTo(0);
    table.timestamp('last_delivery_at', { useTz: true });
    table.timestamp('last_success_at', { useTz: true });
    table.timestamp('last_failure_at', { useTz: true });
    table.timestamp('auto_disabled_at', { useTz: true });
    table.uuid('created_by_user_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'webhook_id']);
    table.index(['tenant'], 'webhooks_tenant_idx');
    table.index(['tenant', 'is_active'], 'webhooks_tenant_active_idx');
  });

  await knex.schema.createTable('webhook_deliveries', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('delivery_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('webhook_id').notNullable();
    table
      .foreign(['tenant', 'webhook_id'])
      .references(['tenant', 'webhook_id'])
      .inTable('webhooks')
      .onDelete('CASCADE');
    table.uuid('event_id').notNullable();
    table.text('event_type').notNullable();
    table.jsonb('request_headers');
    table.jsonb('request_body');
    table.integer('response_status_code');
    table.jsonb('response_headers');
    table.text('response_body');
    table.text('status').notNullable();
    table.integer('attempt_number').notNullable().defaultTo(1);
    table.integer('duration_ms');
    table.text('error_message');
    table.timestamp('next_retry_at', { useTz: true });
    table.boolean('is_test').notNullable().defaultTo(false);
    table.timestamp('attempted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });

    table.primary(['tenant', 'delivery_id']);
  });

  await knex.schema.raw(`
    CREATE INDEX webhook_deliveries_webhook_attempted_idx
    ON webhook_deliveries (tenant, webhook_id, attempted_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX webhook_deliveries_event_idx
    ON webhook_deliveries (tenant, event_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX webhook_deliveries_retry_idx
    ON webhook_deliveries (tenant, next_retry_at)
    WHERE status IN ('pending', 'retrying')
  `);

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    console.warn('[create_webhook_tables] Skipping create_distributed_table (Citus extension unavailable)');
    return;
  }

  for (const tableName of ['webhooks', 'webhook_deliveries']) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('webhook_deliveries');
  await knex.schema.dropTableIfExists('webhooks');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
