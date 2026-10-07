'use strict';

// Catalog entry for the `ticket.status_age` date trigger ("Ticket in status for N days"). The trigger
// itself is a `date` trigger (see shared/workflow/runtime/dateTriggerSourceDefinitions.ts); this row
// makes its payload schema discoverable alongside the other workflow events.
const ROW = {
  event_type: 'TICKET_STATUS_AGE',
  name: 'Ticket In Status For N Days',
  description: 'Fires once a ticket has been in a status (optionally on a board, optionally with no activity) for N days, and optionally every R days while it stays there. Started by the daily date-trigger scan.',
  category: 'Tickets',
  payload_schema_ref: 'payload.TicketStatusAge.v1',
};
const NOW = '2026-10-05T00:00:00.000Z';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  await knex('system_event_catalog').insert({ ...ROW, created_at: NOW, updated_at: NOW })
    .onConflict('event_type').merge({ ...ROW, updated_at: NOW });
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('system_event_catalog')) {
    await knex('system_event_catalog').where({ event_type: ROW.event_type }).del();
  }
};
