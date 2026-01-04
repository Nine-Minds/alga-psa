/**
 * Ticket bundling (master/child tickets).
 *
 * Key decisions:
 * - Children reference the master via tickets.master_ticket_id (nullable).
 * - Bundle behavior/settings are stored per master in ticket_bundle_settings.
 * - Mirrored comment mapping supports idempotent sync updates.
 */

exports.up = async function up(knex) {
  // Add master_ticket_id to tickets
  await knex.schema.alterTable('tickets', (table) => {
    table.uuid('master_ticket_id').nullable();
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_tickets_master_ticket_id
    ON tickets (tenant, master_ticket_id);
  `);

  // Bundle settings per master ticket
  await knex.schema.createTable('ticket_bundle_settings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('master_ticket_id').notNullable();
    table.text('mode').notNullable().defaultTo('sync_updates'); // link_only | sync_updates

    // Policy flags
    table.boolean('reopen_on_child_reply').notNullable().defaultTo(false);

    table.primary(['tenant', 'master_ticket_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'master_ticket_id'])
      .references(['tenant', 'ticket_id'])
      .inTable('tickets')
      .onDelete('CASCADE');
  });

  await knex.raw(`
    ALTER TABLE ticket_bundle_settings
    ADD CONSTRAINT ticket_bundle_settings_mode_check
    CHECK (mode IN ('link_only', 'sync_updates'));
  `);

  // Mirrored comment mapping (source comment on master -> mirrored comment on child)
  await knex.schema.createTable('ticket_bundle_mirrors', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('source_comment_id').notNullable();
    table.uuid('child_ticket_id').notNullable();
    table.uuid('child_comment_id').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'source_comment_id', 'child_ticket_id']);
    table.unique(['tenant', 'child_comment_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'source_comment_id']).references(['tenant', 'comment_id']).inTable('comments').onDelete('CASCADE');
    table.foreign(['tenant', 'child_ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
    table.foreign(['tenant', 'child_comment_id']).references(['tenant', 'comment_id']).inTable('comments').onDelete('CASCADE');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('ticket_bundle_mirrors');
  await knex.raw(`ALTER TABLE ticket_bundle_settings DROP CONSTRAINT IF EXISTS ticket_bundle_settings_mode_check;`);
  await knex.schema.dropTableIfExists('ticket_bundle_settings');
  await knex.raw(`DROP INDEX IF EXISTS idx_tickets_master_ticket_id;`);
  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('master_ticket_id');
  });
};
