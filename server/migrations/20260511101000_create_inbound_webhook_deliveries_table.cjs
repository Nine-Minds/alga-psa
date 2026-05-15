/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tableExists = await knex.schema.hasTable('inbound_webhook_deliveries');

  if (!tableExists) {
    await knex.schema.createTable('inbound_webhook_deliveries', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
      table.uuid('delivery_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('inbound_webhook_id');
      // NOTE: Citus does not allow ON DELETE SET NULL/SET DEFAULT when the
      // distribution column (tenant) is part of the foreign key. Deletion of
      // an inbound_webhook nulls out inbound_webhook_id on related deliveries
      // at the application layer (see deleteInboundWebhook action).
      table
        .foreign(['tenant', 'inbound_webhook_id'])
        .references(['tenant', 'inbound_webhook_id'])
        .inTable('inbound_webhooks');
      table.text('idempotency_key');
      table.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.text('request_method').notNullable();
      table.text('request_path').notNullable();
      table.jsonb('request_headers').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.jsonb('request_body');
      table.text('source_ip');
      table.text('user_agent');
      table
        .text('auth_status')
        .notNullable()
        .checkIn(['verified', 'rejected_signature', 'rejected_bearer', 'rejected_ip', 'rejected_no_auth']);
      table
        .text('dispatch_status')
        .notNullable()
        .defaultTo('pending')
        .checkIn(['pending', 'dispatched', 'duplicate', 'failed']);
      table.jsonb('handler_outcome');
      table.integer('response_status');
      table.jsonb('response_body');
      table.integer('duration_ms');
      table.integer('retry_count').notNullable().defaultTo(0);
      table.boolean('is_replay').notNullable().defaultTo(false);
      table.uuid('replayed_from');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'delivery_id']);
      // NOTE: Citus does not allow ON DELETE SET NULL/SET DEFAULT when the
      // distribution column (tenant) is part of the foreign key. There is no
      // application path that deletes individual delivery rows today; any
      // future delete path must null out replayed_from on dependent rows first.
      table
        .foreign(['tenant', 'replayed_from'])
        .references(['tenant', 'delivery_id'])
        .inTable('inbound_webhook_deliveries');
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_webhook_received_idx
    ON inbound_webhook_deliveries (tenant, inbound_webhook_id, received_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_status_received_idx
    ON inbound_webhook_deliveries (tenant, dispatch_status, received_at DESC)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_idempotency_idx
    ON inbound_webhook_deliveries (tenant, inbound_webhook_id, idempotency_key, received_at DESC)
    WHERE idempotency_key IS NOT NULL
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS inbound_webhook_deliveries_replay_idx
    ON inbound_webhook_deliveries (tenant, replayed_from)
    WHERE replayed_from IS NOT NULL
  `);

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'citus'
    ) AS enabled;
  `);

  if (!citusEnabled.rows?.[0]?.enabled) {
    console.warn('[create_inbound_webhook_deliveries_table] Skipping create_distributed_table (Citus extension unavailable)');
    return;
  }

  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_dist_partition
      WHERE logicalrelid = 'inbound_webhook_deliveries'::regclass
    ) AS is_distributed;
  `);

  if (!alreadyDistributed.rows?.[0]?.is_distributed) {
    await knex.raw(
      "SELECT create_distributed_table('inbound_webhook_deliveries', 'tenant', colocate_with => 'inbound_webhooks')",
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_webhook_deliveries');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
