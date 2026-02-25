/**
 * Add nullable inbound_ticket_defaults_id to clients.
 *
 * This enables client-owned inbound destination defaults for new-ticket routing.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('clients');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id');
  if (hasColumn) return;

  await knex.schema.alterTable('clients', (table) => {
    table.uuid('inbound_ticket_defaults_id').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('clients');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id');
  if (!hasColumn) return;

  await knex.schema.alterTable('clients', (table) => {
    table.dropColumn('inbound_ticket_defaults_id');
  });
};
