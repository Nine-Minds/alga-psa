/**
 * Create calendar_event_mappings table for tracking sync relationships
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tableName = 'calendar_event_mappings';
  const exists = await knex.schema.hasTable(tableName);

  if (!exists) {
    await knex.schema.createTable(tableName, (table) => {
      table.uuid('id').notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('calendar_provider_id').notNullable();
      table.uuid('schedule_entry_id').notNullable();
      table.string('external_event_id', 255).notNullable();
      table
        .enu('sync_status', ['synced', 'pending', 'conflict', 'error'])
        .defaultTo('pending');
      table.timestamp('last_synced_at').nullable();
      table.text('sync_error_message').nullable();
      table.enu('sync_direction', ['to_external', 'from_external']).nullable();
      table.timestamp('alga_last_modified').nullable();
      table.timestamp('external_last_modified').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['id', 'tenant']);
      table.foreign('tenant').references('tenant').inTable('tenants');
    });
  }

  const indexStatements = [
    `
      CREATE INDEX IF NOT EXISTS calendar_event_mappings_tenant_calendar_provider_id_index
        ON ${tableName} (tenant, calendar_provider_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS calendar_event_mappings_tenant_schedule_entry_id_index
        ON ${tableName} (tenant, schedule_entry_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS calendar_event_mappings_tenant_external_event_id_index
        ON ${tableName} (tenant, external_event_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS calendar_event_mappings_tenant_sync_status_index
        ON ${tableName} (tenant, sync_status)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_mappings_tenant_schedule_entry_id_calendar_provider_id_unique
        ON ${tableName} (tenant, schedule_entry_id, calendar_provider_id)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_mappings_tenant_external_event_id_calendar_provider_id_unique
        ON ${tableName} (tenant, external_event_id, calendar_provider_id)
    `,
  ];

  for (const statement of indexStatements) {
    await knex.raw(statement);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('calendar_event_mappings');
};
