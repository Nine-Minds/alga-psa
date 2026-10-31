'use strict';

/**
 * Advance-replacement dead-unit shipping (alga-2026-0002683, C5 follow-up). PRD:
 * ee/docs/plans/2026-10-29-advance-replacement-dead-unit/PRD.md
 *
 * Widens two CHECK constraints, nothing else (`rma_cases.status` already allows `dead_unit_owed`):
 *   - asset_custody_close_reason_check  + 'returned_to_vendor'  (the MSP shipped the dead unit to the vendor and the
 *     vendor confirmed receipt; never 'returned_to_client')
 *   - rma_events_type_check             + 'dead_unit_shipped', 'vendor_receipt_confirmed'
 *
 * Each is re-stated NOT VALID and then VALIDATEd in the same file: widening a CHECK cannot invalidate an existing
 * row, so VALIDATE only takes a SHARE UPDATE EXCLUSIVE lock and scans, but it is kept in a separate statement so
 * the ACCESS EXCLUSIVE lock of the DROP/ADD is held only momentarily. Idempotent.
 *
 * `down` narrows the constraints back, after refusing if any row already uses a new value (rolling back over live
 * data would otherwise fail on VALIDATE with a less helpful message).
 */

const CLOSE_REASONS = ['returned_to_client', 'disposed', 'transferred_to_rma'];
const NEW_CLOSE_REASONS = [...CLOSE_REASONS, 'returned_to_vendor'];
const EVENT_TYPES = [
  'opened', 'warranty_approved', 'warranty_denied', 'device_received', 'shipped_outbound', 'vendor_case_recorded',
  'replacement_received', 'repair_received', 'vendor_credited', 'returned_to_client', 'closed', 'note',
];
const NEW_EVENT_TYPES = [...EVENT_TYPES.slice(0, EVENT_TYPES.indexOf('closed')), 'dead_unit_shipped', 'vendor_receipt_confirmed', 'closed', 'note'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

async function restate(knex, table, constraint, expression) {
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${expression}) NOT VALID`);
  await knex.raw(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint}`);
}

exports.up = async function up(knex) {
  await restate(knex, 'asset_custody', 'asset_custody_close_reason_check', `close_reason IS NULL OR close_reason IN (${list(NEW_CLOSE_REASONS)})`);
  await restate(knex, 'rma_events', 'rma_events_type_check', `event_type IN (${list(NEW_EVENT_TYPES)})`);
};

exports.down = async function down(knex) {
  const used = await knex.raw(
    `SELECT
       (SELECT count(*) FROM asset_custody WHERE close_reason = 'returned_to_vendor')::int AS custody,
       (SELECT count(*) FROM rma_events WHERE event_type IN ('dead_unit_shipped', 'vendor_receipt_confirmed'))::int AS events`
  );
  const { custody, events } = used.rows[0];
  if (custody > 0 || events > 0) {
    throw new Error(
      `Cannot roll back: ${custody} custody episode(s) closed as returned_to_vendor and ${events} dead-unit RMA event(s) exist.`
    );
  }
  await restate(knex, 'asset_custody', 'asset_custody_close_reason_check', `close_reason IS NULL OR close_reason IN (${list(CLOSE_REASONS)})`);
  await restate(knex, 'rma_events', 'rma_events_type_check', `event_type IN (${list(EVENT_TYPES)})`);
};
