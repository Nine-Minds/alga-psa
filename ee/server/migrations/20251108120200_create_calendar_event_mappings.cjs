/**
 * EE override that skips creation when calendar_event_mappings already exists.
 * On fresh installs the earlier base migration already provisioned this table,
 * so re-running the original script should be a no-op.
 *
 * @param { import('knex').Knex } knex
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('calendar_event_mappings');
  if (exists) {
    console.log('[calendar_event_mappings] Table already exists, skipping creation');
    return;
  }

  await knex.schema.createTable('calendar_event_mappings', (table) => {
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
    table.index(['tenant', 'calendar_provider_id']);
    table.index(['tenant', 'schedule_entry_id']);
    table.index(['tenant', 'external_event_id']);
    table.index(['tenant', 'sync_status']);
    table.unique(['tenant', 'schedule_entry_id', 'calendar_provider_id']);
    table.unique(['tenant', 'external_event_id', 'calendar_provider_id']);
  });

  console.log('[calendar_event_mappings] Table created');
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable('calendar_event_mappings');
  if (exists) {
    await knex.schema.dropTable('calendar_event_mappings');
    console.log('[calendar_event_mappings] Table dropped');
  }
};
