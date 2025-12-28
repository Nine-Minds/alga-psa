'use strict';

/**
 * Add payload_schema_ref for EMAIL_PROVIDER_CONNECTED / EMAIL_PROVIDER_DISCONNECTED.
 *
 * These events already exist in system_event_catalog (and may have been copied into tenant event_catalog).
 * The schema refs are used by the workflow v2 event simulator (form mode) and validation.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const now = knex.fn.now();
  const updates = [
    { event_type: 'EMAIL_PROVIDER_CONNECTED', payload_schema_ref: 'payload.EmailProviderConnected.v1' },
    { event_type: 'EMAIL_PROVIDER_DISCONNECTED', payload_schema_ref: 'payload.EmailProviderDisconnected.v1' }
  ];

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (hasCol) {
      for (const u of updates) {
        await knex('system_event_catalog')
          .where({ event_type: u.event_type })
          .update({ payload_schema_ref: u.payload_schema_ref, updated_at: now });
      }
    }
  }

  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (hasCol) {
      for (const u of updates) {
        await knex('event_catalog')
          .where({ event_type: u.event_type })
          .update({ payload_schema_ref: u.payload_schema_ref, updated_at: now });
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const now = knex.fn.now();
  const eventTypes = ['EMAIL_PROVIDER_CONNECTED', 'EMAIL_PROVIDER_DISCONNECTED'];

  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('event_catalog')
        .whereIn('event_type', eventTypes)
        .update({ payload_schema_ref: null, updated_at: now });
    }
  }

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex('system_event_catalog')
        .whereIn('event_type', eventTypes)
        .update({ payload_schema_ref: null, updated_at: now });
    }
  }
};

