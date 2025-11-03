/**
 * Create calendar_providers table for managing calendar integrations
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tableName = 'calendar_providers';
  const exists = await knex.schema.hasTable(tableName);

  if (!exists) {
    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').notNullable();
      table.uuid('tenant').notNullable();

      table.string('provider_type', 50).notNullable(); // 'google', 'microsoft'
      table.string('provider_name', 255).notNullable(); // User-friendly name
      table.string('calendar_id', 255).notNullable(); // External calendar ID
      table.boolean('is_active').defaultTo(true);

      table
        .enu('sync_direction', ['bidirectional', 'to_external', 'from_external'])
        .defaultTo('bidirectional');

      table
        .enu('status', ['connected', 'disconnected', 'error', 'configuring'])
        .defaultTo('configuring');
      table.timestamp('last_sync_at').nullable();
      table.text('error_message').nullable();

      table.jsonb('vendor_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));

      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.unique(['tenant', 'calendar_id', 'provider_type']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS calendar_providers_tenant_is_active_index
      ON ${tableName} (tenant, is_active)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS calendar_providers_tenant_provider_type_index
      ON ${tableName} (tenant, provider_type)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS calendar_providers_tenant_calendar_id_index
      ON ${tableName} (tenant, calendar_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('calendar_providers');
};
