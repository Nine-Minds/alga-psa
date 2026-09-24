'use strict';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  const now = '2026-09-23T00:00:00.000Z';
  await knex('system_event_catalog').insert({
    event_type: 'CLIENT_ANNIVERSARY_UPCOMING',
    name: 'Client Anniversary Upcoming',
    description: 'Triggered on configured threshold days before a client record anniversary.',
    category: 'CRM',
    payload_schema_ref: 'payload.ClientAnniversaryUpcoming.v1',
    created_at: now,
    updated_at: now,
  }).onConflict('event_type').merge({
    name: 'Client Anniversary Upcoming',
    description: 'Triggered on configured threshold days before a client record anniversary.',
    category: 'CRM',
    payload_schema_ref: 'payload.ClientAnniversaryUpcoming.v1',
    updated_at: now,
  });
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('system_event_catalog')) {
    await knex('system_event_catalog').where({ event_type: 'CLIENT_ANNIVERSARY_UPCOMING' }).del();
  }
};
