'use strict';

/**
 * Registers the client location lifecycle events in system_event_catalog.
 * Mirrors WORKFLOW_EVENT_CATALOG in packages/event-schemas/src/workflowEventCatalog.ts; the
 * integration-lane parity test (server/src/test/infrastructure/workflowEventCatalogParity.test.ts)
 * keeps the two in step.
 */

const EVENTS = [
  ['CLIENT_LOCATION_CREATED', 'Client Location Created', 'A location is added to a client.', 'CRM', 'payload.ClientLocationCreated.v1'],
  ['CLIENT_LOCATION_UPDATED', 'Client Location Updated', 'A client location is changed (including re-activation).', 'CRM', 'payload.ClientLocationUpdated.v1'],
  ['CLIENT_LOCATION_DEACTIVATED', 'Client Location Deactivated', 'A client location is marked inactive.', 'CRM', 'payload.ClientLocationDeactivated.v1'],
  ['CLIENT_LOCATION_DELETED', 'Client Location Deleted', 'A client location is permanently removed.', 'CRM', 'payload.ClientLocationDeleted.v1'],
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  // Literal timestamp: Citus rejects non-IMMUTABLE functions in ON CONFLICT DO UPDATE SET.
  const now = new Date().toISOString();

  for (const [eventType, name, description, category, payloadSchemaRef] of EVENTS) {
    // migration-lint: allow 5 - retroactive: seeds a fixed handful of event-catalog rows via upsert; row count is bounded by the literal EVENTS list, not by table size
    await knex.raw(
      `
      INSERT INTO system_event_catalog (event_id, event_type, name, description, category, payload_schema_ref, created_at, updated_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
      ON CONFLICT (event_type) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        payload_schema_ref = EXCLUDED.payload_schema_ref,
        updated_at = ?::timestamptz
    `,
      [eventType, name, description, category, payloadSchemaRef, now, now, now],
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  await knex('system_event_catalog').whereIn('event_type', EVENTS.map(([eventType]) => eventType)).del();
};
