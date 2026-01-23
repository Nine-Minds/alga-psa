'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const now = knex.fn.now();

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (!hasCol) {
      await knex.schema.alterTable('system_event_catalog', (table) => {
        table.text('payload_schema_ref').nullable();
        table.index(['payload_schema_ref'], 'idx_system_event_catalog_payload_schema_ref');
      });
    }

    await knex('system_event_catalog')
      .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
      .update({
        payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
        updated_at: now
      });
  }

  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (!hasCol) {
      await knex.schema.alterTable('event_catalog', (table) => {
        table.text('payload_schema_ref').nullable();
        table.index(['payload_schema_ref'], 'idx_event_catalog_payload_schema_ref');
      });
    }

    await knex('event_catalog')
      .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
      .update({
        payload_schema_ref: 'payload.EmailWorkflowPayload.v1',
        updated_at: now
      });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('event_catalog')) {
    const hasCol = await knex.schema.hasColumn('event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex.schema.alterTable('event_catalog', (table) => {
        table.dropColumn('payload_schema_ref');
      });
    }
  }

  if (await knex.schema.hasTable('system_event_catalog')) {
    const hasCol = await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref');
    if (hasCol) {
      await knex.schema.alterTable('system_event_catalog', (table) => {
        table.dropColumn('payload_schema_ref');
      });
    }
  }
};
