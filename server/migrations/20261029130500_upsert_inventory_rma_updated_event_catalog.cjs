'use strict';

/** Catalog row for INVENTORY_RMA_UPDATED (alga-2026-0002683, C5). Idempotent upsert. */
const EVENT = {
  event_type: 'INVENTORY_RMA_UPDATED',
  name: 'Inventory RMA Updated',
  description: 'A warranty claim / RMA case changed status or details.',
  category: 'Inventory',
  payload_schema_ref: 'payload.InventoryRmaUpdated.v1',
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) return;
  const now = new Date().toISOString();
  // migration-lint: allow 5 - upserts exactly one fixed event-catalog row (ON CONFLICT on event_type); the write is bounded by the literal EVENT, not by table size
  await knex.raw(
    `
      INSERT INTO system_event_catalog (event_id, event_type, name, description, category, payload_schema_ref, created_at, updated_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
      ON CONFLICT (event_type) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        payload_schema_ref = EXCLUDED.payload_schema_ref,
        updated_at = EXCLUDED.updated_at
    `,
    [EVENT.event_type, EVENT.name, EVENT.description, EVENT.category, EVENT.payload_schema_ref, now, now]
  );
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  await knex('system_event_catalog').where({ event_type: EVENT.event_type }).del();
};
