/**
 * Add nullable inbound_ticket_defaults_id to contacts.
 *
 * This enables per-sender contact overrides for inbound destination defaults.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('contacts');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('contacts', 'inbound_ticket_defaults_id');
  if (hasColumn) return;

  await knex.schema.alterTable('contacts', (table) => {
    table.uuid('inbound_ticket_defaults_id').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('contacts');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('contacts', 'inbound_ticket_defaults_id');
  if (!hasColumn) return;

  await knex.schema.alterTable('contacts', (table) => {
    table.dropColumn('inbound_ticket_defaults_id');
  });
};
