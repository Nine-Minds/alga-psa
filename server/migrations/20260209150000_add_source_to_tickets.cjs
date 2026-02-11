/**
 * Add source to tickets.
 *
 * The shared TicketModel writes `source` on ticket creation, but some
 * environments can be missing this column. This migration makes the schema
 * consistent with runtime writes.
 *
 * NOTE: tickets is distributed in Citus, so ALTER TABLE must run outside a transaction.
 */
exports.up = async function up(knex) {
  const hasSource = await knex.schema.hasColumn('tickets', 'source');
  if (hasSource) {
    return;
  }

  await knex.schema.alterTable('tickets', (table) => {
    table.text('source').nullable();
  });
};

exports.down = async function down(knex) {
  const hasSource = await knex.schema.hasColumn('tickets', 'source');
  if (!hasSource) {
    return;
  }

  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('source');
  });
};

exports.config = { transaction: false };
