/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tableExists = await knex.schema.hasTable('inbound_webhooks');

  if (!tableExists) {
    await knex.schema.createTable('inbound_webhooks', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
      table.uuid('inbound_webhook_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('name').notNullable();
      table.text('slug').notNullable();
      table.text('description');
      table
        .text('auth_type')
        .notNullable()
        .checkIn(['hmac_sha256', 'bearer', 'ip_allowlist', 'path_token']);
      table.jsonb('auth_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.jsonb('idempotency_source');
      table.integer('idempotency_window_seconds').notNullable().defaultTo(86400);
      table
        .text('handler_type')
        .notNullable()
        .checkIn(['direct_action', 'workflow']);
      table.jsonb('handler_config').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.jsonb('sample_payload');
      table.timestamp('sample_capture_expires_at', { useTz: true });
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('rate_limit_per_minute').notNullable().defaultTo(600);
      table.timestamp('auto_disabled_at', { useTz: true });
      table.uuid('created_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'inbound_webhook_id']);
      table.unique(['tenant', 'slug'], { indexName: 'inbound_webhooks_tenant_slug_unique' });
      table.index(['tenant', 'is_active'], 'inbound_webhooks_tenant_active_idx');
      table.index(['tenant', 'updated_at'], 'inbound_webhooks_tenant_updated_idx');
    });
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    console.warn('[create_inbound_webhooks_table] Skipping create_distributed_table (Citus extension unavailable)');
    return;
  }

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = 'inbound_webhooks'::regclass
    ) AS is_distributed;
  `);

  if (!alreadyDistributed.rows?.[0]?.is_distributed) {
    await knex.raw("SELECT create_distributed_table('inbound_webhooks', 'tenant', colocate_with => 'tenants')");
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_webhooks');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
