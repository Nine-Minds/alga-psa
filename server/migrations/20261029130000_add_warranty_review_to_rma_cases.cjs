'use strict';

/**
 * Warranty review for client-owned equipment (alga-2026-0002683, card C5).
 * Design of record: ee/docs/plans/2026-10-25-warranty-review-and-rma/PRD.md ("Data model").
 *
 * Extends `rma_cases` in place. A case is a client-asset warranty claim exactly when
 * `returned_unit_id IS NULL`; no ownership/type column is added. Stock-unit RMAs keep every column and
 * transition they had.
 *
 * - new columns: rma_number, ticket_id, custody_id, warranty decision, closed_reason, outbound/inbound
 *   shipping, return_by, return_ship_to, replacement fields
 * - status CHECK re-stated with `warranty_review` and `repaired` (`dead_unit_returned` stays out: the
 *   hardening migration 20260701092000 already stopped accepting it)
 * - rma_number NOT NULL, unique per tenant, and `next_number` for entity type RMA seeded at the backfilled
 *   maximum so a new claim never collides
 * - closed cases backfill closed_reason = 'resolved'
 *
 * Split in three so each step is safe on a live table (migration-lint rules 1, 2, 3, 5):
 *   1. this file: nullable columns, and every CHECK re-stated NOT VALID
 *   2. 20261029130100: batched backfill of closed_reason, rma_number and next_number, then the rma_number
 *      presence CHECK (NOT VALID; it cannot exist earlier because UPDATEs re-check NOT VALID constraints)
 *   3. 20261029130200 (transaction: false): VALIDATE the CHECKs, build the indexes CONCURRENTLY,
 *      SET NOT NULL on rma_number, add the composite FKs
 *
 * Numbering note: ordered after 20261028134000 (the newest migration on main when C5 was rebased).
 * Idempotent; safe to re-run. Step 3 fails on the asset_custody FK when C4 is absent, on purpose.
 */

const STATUSES = [
  'open', 'awaiting_return', 'returned', 'sent_to_vendor', 'replacement_received', 'replacement_deployed',
  'dead_unit_owed', 'replaced', 'repaired', 'credited', 'charged', 'closed', 'warranty_review',
];
const OLD_STATUSES = STATUSES.filter((s) => s !== 'warranty_review' && s !== 'repaired');
const OUTCOMES = ['covered', 'not_covered', 'unknown'];
const CLOSED_REASONS = ['resolved', 'warranty_denied', 'cancelled', 'duplicate', 'vendor_credited'];

const list = (values) => values.map((v) => `'${v}'::text`).join(', ');

const TEXT_COLUMNS = [
  'denial_reason', 'closed_reason', 'warranty_outcome', 'outbound_carrier', 'outbound_tracking_number',
  'inbound_carrier', 'inbound_tracking_number', 'return_ship_to', 'replacement_serial_number',
];
const TIMESTAMP_COLUMNS = [
  'warranty_decided_at', 'outbound_shipped_at', 'inbound_received_at', 'replacement_received_at',
];

exports.up = async function up(knex) {
  const has = (column) => knex.schema.hasColumn('rma_cases', column);

  for (const column of ['rma_number']) {
    if (!(await has(column))) await knex.schema.alterTable('rma_cases', (t) => t.text(column).nullable());
  }
  for (const column of ['ticket_id', 'custody_id', 'warranty_decided_by']) {
    if (!(await has(column))) await knex.schema.alterTable('rma_cases', (t) => t.uuid(column).nullable());
  }
  for (const column of TEXT_COLUMNS) {
    if (!(await has(column))) await knex.schema.alterTable('rma_cases', (t) => t.text(column).nullable());
  }
  for (const column of TIMESTAMP_COLUMNS) {
    if (!(await has(column))) await knex.schema.alterTable('rma_cases', (t) => t.timestamp(column, { useTz: true }).nullable());
  }
  if (!(await has('return_by'))) await knex.schema.alterTable('rma_cases', (t) => t.date('return_by').nullable());

  // --- status / outcome / reason CHECKs ---
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_status_check');
  await knex.raw(`ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[${list(STATUSES)}])) NOT VALID`);
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_warranty_outcome_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_warranty_outcome_check CHECK (warranty_outcome IS NULL OR warranty_outcome IN (${list(OUTCOMES)})) NOT VALID`
  );
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_closed_reason_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_closed_reason_check CHECK (closed_reason IS NULL OR closed_reason IN (${list(CLOSED_REASONS)})) NOT VALID`
  );
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_denial_reason_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_denial_reason_check CHECK (warranty_outcome IS DISTINCT FROM 'not_covered' OR (denial_reason IS NOT NULL AND length(btrim(denial_reason)) > 0)) NOT VALID`
  );
};

exports.down = async function down(knex) {
  for (const constraint of ['rma_cases_ticket_fk', 'rma_cases_custody_fk', 'rma_cases_warranty_decided_by_fk']) {
    await knex.raw(`ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  for (const index of [
    'rma_cases_tenant_rma_number_unique', 'idx_rma_cases_ticket', 'idx_rma_cases_asset', 'idx_rma_cases_status_return_by',
  ]) {
    await knex.raw(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const constraint of [
    'rma_cases_warranty_outcome_check', 'rma_cases_closed_reason_check', 'rma_cases_denial_reason_check',
    'rma_cases_rma_number_present_check',
  ]) {
    await knex.raw(`ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  // Claims in the new statuses cannot satisfy the old CHECK: fold them into the nearest legacy status.
  await knex.raw(`UPDATE rma_cases SET status = 'closed', closed_at = COALESCE(closed_at, now()) WHERE status = 'warranty_review'`);
  await knex.raw(`UPDATE rma_cases SET status = 'replaced' WHERE status = 'repaired'`);
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_status_check');
  await knex.raw(`ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[${list(OLD_STATUSES)}]))`);
  await knex.raw('ALTER TABLE rma_cases ALTER COLUMN rma_number DROP NOT NULL');
  await knex('next_number').where({ entity_type: 'RMA' }).del();
  const columns = [
    'rma_number', 'ticket_id', 'custody_id', 'warranty_decided_by', 'return_by', ...TEXT_COLUMNS, ...TIMESTAMP_COLUMNS,
  ];
  for (const column of columns) {
    if (await knex.schema.hasColumn('rma_cases', column)) {
      await knex.schema.alterTable('rma_cases', (t) => t.dropColumn(column));
    }
  }
};
