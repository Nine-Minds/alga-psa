exports.up = async function(knex) {
  await knex.schema.alterTable('statuses', function(table) {
    table.uuid('board_id').nullable();
    table.index(['tenant', 'board_id'], 'statuses_tenant_board_id_idx');
    table
      .foreign(['tenant', 'board_id'], 'statuses_tenant_board_id_fk')
      .references(['tenant', 'board_id'])
      .inTable('boards');
  });

  await knex.raw(`
    ALTER TABLE statuses
    DROP CONSTRAINT IF EXISTS unique_tenant_name_type
  `);

  await knex.raw(`
    ALTER TABLE statuses
    DROP CONSTRAINT IF EXISTS unique_tenant_type_order
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX statuses_ticket_board_name_unique_idx
      ON statuses (tenant, board_id, name)
      WHERE status_type = 'ticket'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX statuses_ticket_board_order_unique_idx
      ON statuses (tenant, board_id, order_number)
      WHERE status_type = 'ticket'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX statuses_ticket_board_default_unique_idx
      ON statuses (tenant, board_id)
      WHERE status_type = 'ticket' AND is_default = true
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX statuses_non_ticket_name_unique_idx
      ON statuses (tenant, status_type, name)
      WHERE status_type <> 'ticket'
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX statuses_non_ticket_order_unique_idx
      ON statuses (tenant, status_type, order_number)
      WHERE status_type <> 'ticket'
  `);

  await knex.raw(`
    CREATE INDEX statuses_ticket_board_lookup_idx
      ON statuses (tenant, board_id, order_number, status_id)
      WHERE status_type = 'ticket'
  `);
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS statuses_ticket_board_lookup_idx');
  await knex.raw('DROP INDEX IF EXISTS statuses_non_ticket_order_unique_idx');
  await knex.raw('DROP INDEX IF EXISTS statuses_non_ticket_name_unique_idx');
  await knex.raw('DROP INDEX IF EXISTS statuses_ticket_board_default_unique_idx');
  await knex.raw('DROP INDEX IF EXISTS statuses_ticket_board_order_unique_idx');
  await knex.raw('DROP INDEX IF EXISTS statuses_ticket_board_name_unique_idx');

  await knex.schema.alterTable('statuses', function(table) {
    table.dropForeign(['tenant', 'board_id'], 'statuses_tenant_board_id_fk');
    table.dropIndex(['tenant', 'board_id'], 'statuses_tenant_board_id_idx');
    table.dropColumn('board_id');
  });

  await knex.schema.alterTable('statuses', function(table) {
    table.unique(['tenant', 'name', 'status_type'], 'unique_tenant_name_type');
    table.unique(['tenant', 'status_type', 'order_number'], 'unique_tenant_type_order');
  });
};
