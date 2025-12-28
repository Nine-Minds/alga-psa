'use strict';

/**
 * Switch INBOUND_EMAIL_RECEIVED payload_schema_ref to a schema that does not expose tenant.
 *
 * The tenant is inferred from the authenticated session when simulating events.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const now = knex.fn.now();

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('system_event_catalog')
        .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
        .update({
          payload_schema_ref: 'payload.InboundEmailReceived.v1',
          updated_at: now
        });
    }
  }

  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('event_catalog')
        .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
        .update({
          payload_schema_ref: 'payload.InboundEmailReceived.v1',
          updated_at: now
        });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const now = knex.fn.now();

  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('event_catalog')
        .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
        .update({
          payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
          updated_at: now
        });
    }
  }

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('system_event_catalog')
        .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
        .update({
          payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
          updated_at: now
        });
    }
  }
};

