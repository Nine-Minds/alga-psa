'use strict';

/** Catalog row for ASSET_CUSTODY_CHANGED (alga-2026-0002683, C4). Idempotent upsert. */
const EVENT = {
  event_type: 'ASSET_CUSTODY_CHANGED',
  name: 'Asset Custody Changed',
  description: 'Client equipment in MSP custody was received, moved, handed off, shipped, returned or its details updated.',
  category: 'Assets',
  payload_schema_ref: 'payload.AssetCustodyChanged.v1',
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  if (!(await knex.schema.hasColumn('system_event_catalog', 'payload_schema_ref'))) return;
  const now = new Date().toISOString();
  // migration-lint: allow 5 - retroactive: single upsert of one event-catalog row; bounded by a literal, not by table size
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
