/**
 * Provenance for "Duplicate ticket".
 *
 * `tickets.duplicated_from_ticket_id` records which ticket a copy was created
 * from. It is create-only (written by `addTicket`, never by `updateTicket`).
 *
 * Deliberately no foreign key and no index:
 *  - deleting the source ticket must neither be blocked nor cascade, and a
 *    composite (tenant, ticket_id) ON DELETE SET NULL would null `tenant` on
 *    Citus / PG < 15;
 *  - readers join `tickets` on (tenant, ticket_id), so a deleted source simply
 *    yields no row and the "Duplicated from" link is hidden.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('tickets'))) {
    return;
  }
  if (await knex.schema.hasColumn('tickets', 'duplicated_from_ticket_id')) {
    return;
  }
  await knex.raw('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS duplicated_from_ticket_id uuid NULL');
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('tickets'))) {
    return;
  }
  if (!(await knex.schema.hasColumn('tickets', 'duplicated_from_ticket_id'))) {
    return;
  }
  await knex.raw('ALTER TABLE tickets DROP COLUMN IF EXISTS duplicated_from_ticket_id');
};
