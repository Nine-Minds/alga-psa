/**
 * EE override ensuring calendar provider tables are created idempotently.
 * If the base migrations already provisioned these tables, we skip creation
 * so subsequent migrations continue without errors.
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

exports.up = async function up(knex) {
  const providersExists = await knex.schema.hasTable('calendar_providers');
  if (providersExists) {
    console.log('[calendar_providers] Table already exists, skipping creation');
  } else {
    await knex.schema.createTable('calendar_providers', (table) => {
      table.uuid('id').notNullable();
      table.uuid('tenant').notNullable();
      table.string('provider_type', 50).notNullable();
      table.string('provider_name', 255).notNullable();
      table.string('calendar_id', 255).notNullable();
      table.boolean('is_active').defaultTo(true);
      table.specificType('sync_direction', 'text').notNullable().defaultTo('bidirectional');
      table
        .specificType('status', 'text')
        .notNullable()
        .defaultTo('configuring');
      table.timestamp('last_sync_at').nullable();
      table.text('error_message').nullable();
      table.jsonb('vendor_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['id', 'tenant'], { constraintName: 'calendar_providers_pkey' });
    });

    // add explicit check constraints to match original schema
    await knex.schema.raw(`
      ALTER TABLE calendar_providers
      ADD CONSTRAINT calendar_providers_sync_direction_check
      CHECK (sync_direction IN ('bidirectional', 'to_external', 'from_external'))
    `);

    await knex.schema.raw(`
      ALTER TABLE calendar_providers
      ADD CONSTRAINT calendar_providers_status_check
      CHECK (status IN ('connected', 'disconnected', 'error', 'configuring'))
    `);

    await knex.schema.alterTable('calendar_providers', (table) => {
      table.unique(['tenant', 'calendar_id', 'provider_type'], {
        indexName: 'calendar_providers_tenant_calendar_id_provider_type_unique'
      });
    });

    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_calendar_providers_tenant
      ON calendar_providers (tenant)
    `);

    await knex.schema.raw(`
      CREATE INDEX IF NOT EXISTS idx_calendar_providers_status
      ON calendar_providers (status)
    `);

    await ensureDistributed(knex, 'calendar_providers');
    console.log('[calendar_providers] Table created');
  }
};

exports.down = async function down(knex) {
  const providersExists = await knex.schema.hasTable('calendar_providers');
  if (providersExists) {
    await knex.schema.dropTable('calendar_providers');
    console.log('[calendar_providers] Table dropped');
  } else {
    console.log('[calendar_providers] Table already absent, nothing to drop');
  }
};
