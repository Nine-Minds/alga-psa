'use strict';

/**
 * Registers the quote lifecycle events in system_event_catalog.
 * Mirrors WORKFLOW_EVENT_CATALOG in packages/event-schemas/src/workflowEventCatalog.ts; the
 * integration-lane parity test (server/src/test/infrastructure/workflowEventCatalogParity.test.ts)
 * keeps the two in step.
 */

const EVENTS = [
  ['QUOTE_SENT', 'Quote Sent', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteSent.v1'],
  ['QUOTE_VIEWED', 'Quote Viewed', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteViewed.v1'],
  ['QUOTE_APPROVED', 'Quote Approved', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteApproved.v1'],
  ['QUOTE_ACCEPTED', 'Quote Accepted', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteAccepted.v1'],
  ['QUOTE_REJECTED', 'Quote Rejected', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteRejected.v1'],
  ['QUOTE_EXPIRED', 'Quote Expired', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteExpired.v1'],
  ['QUOTE_CONVERTED', 'Quote Converted', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteConverted.v1'],
  ['QUOTE_CONVERSION_REVERTED', 'Quote Conversion Reverted', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteConversionReverted.v1'],
  ['QUOTE_SUPERSEDED', 'Quote Superseded', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteSuperseded.v1'],
  ['QUOTE_CANCELLED', 'Quote Cancelled', 'A quote lifecycle transition occurred.', 'CRM', 'payload.QuoteCancelled.v1'],
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
