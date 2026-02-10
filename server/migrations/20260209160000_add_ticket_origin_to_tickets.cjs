/**
 * Add ticket_origin to tickets and backfill legacy rows.
 *
 * NOTE: tickets is distributed in Citus, so ALTER TABLE must run outside a transaction.
 */
exports.up = async function up(knex) {
  const hasTicketOrigin = await knex.schema.hasColumn('tickets', 'ticket_origin');

  if (!hasTicketOrigin) {
    await knex.schema.alterTable('tickets', (table) => {
      table.text('ticket_origin').nullable().defaultTo('internal');
    });
  }

  const hasEmailMetadata = await knex.schema.hasColumn('tickets', 'email_metadata');
  if (hasEmailMetadata) {
    await knex.raw(`
      UPDATE tickets
      SET ticket_origin = 'inbound_email'
      WHERE ticket_origin IS NULL
        AND email_metadata IS NOT NULL
    `);
  }

  await knex.raw(`
    UPDATE tickets t
    SET ticket_origin = 'client_portal'
    FROM users u
    WHERE t.ticket_origin IS NULL
      AND t.tenant = u.tenant
      AND t.entered_by = u.user_id
      AND lower(coalesce(u.user_type, '')) = 'client'
  `);

  await knex.raw(`
    UPDATE tickets
    SET ticket_origin = 'internal'
    WHERE ticket_origin IS NULL
  `);
};

exports.down = async function down(knex) {
  const hasTicketOrigin = await knex.schema.hasColumn('tickets', 'ticket_origin');
  if (!hasTicketOrigin) {
    return;
  }

  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('ticket_origin');
  });
};

exports.config = { transaction: false };
