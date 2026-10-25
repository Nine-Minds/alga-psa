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
 * - rma_number backfilled per tenant (RMA-00001 ...), NOT NULL, unique per tenant, and `next_number`
 *   for entity type RMA seeded at the backfilled maximum so a new claim never collides
 * - closed cases backfill closed_reason = 'resolved'
 *
 * Numbering note: ordered after 20261025080000 (the newest migration on main when C5 was built).
 * Idempotent; safe to re-run. Fails on the asset_custody FK when C4 is absent, on purpose.
 */

const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

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
  await knex.raw(`ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[${list(STATUSES)}]))`);
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_warranty_outcome_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_warranty_outcome_check CHECK (warranty_outcome IS NULL OR warranty_outcome IN (${list(OUTCOMES)}))`
  );
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_closed_reason_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_closed_reason_check CHECK (closed_reason IS NULL OR closed_reason IN (${list(CLOSED_REASONS)}))`
  );
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_denial_reason_check');
  await knex.raw(
    `ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_denial_reason_check CHECK (warranty_outcome IS DISTINCT FROM 'not_covered' OR (denial_reason IS NOT NULL AND length(btrim(denial_reason)) > 0))`
  );

  // --- backfill ---
  await knex.raw(`
    UPDATE rma_cases SET closed_reason = 'resolved'
    WHERE closed_reason IS NULL AND (closed_at IS NOT NULL OR status = 'closed')
  `);
  await knex.raw(`
    WITH numbered AS (
      SELECT tenant, rma_id,
             ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY opened_at NULLS FIRST, created_at NULLS FIRST, rma_id) AS n
      FROM rma_cases
      WHERE rma_number IS NULL
    ), base AS (
      SELECT tenant, COALESCE(MAX(NULLIF(regexp_replace(rma_number, '\\D', '', 'g'), '')::bigint), 0) AS max_n
      FROM rma_cases WHERE rma_number IS NOT NULL GROUP BY tenant
    )
    UPDATE rma_cases r
    SET rma_number = 'RMA-' || LPAD((COALESCE(b.max_n, 0) + numbered.n)::text, 5, '0')
    FROM numbered
    LEFT JOIN base b ON b.tenant = numbered.tenant
    WHERE r.tenant = numbered.tenant AND r.rma_id = numbered.rma_id
  `);
  // next_number for RMA continues above the highest number in use (and never moves backwards).
  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT t.tenant, 'RMA',
           COALESCE((SELECT MAX(NULLIF(regexp_replace(r.rma_number, '\\D', '', 'g'), '')::bigint)
                     FROM rma_cases r WHERE r.tenant = t.tenant), 0),
           1, 'RMA-', 5
    FROM tenants t
    ON CONFLICT (tenant, entity_type) DO UPDATE
      SET last_number = GREATEST(next_number.last_number, EXCLUDED.last_number)
  `);

  await knex.raw('ALTER TABLE rma_cases ALTER COLUMN rma_number SET NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS rma_cases_tenant_rma_number_unique ON rma_cases (tenant, rma_number)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rma_cases_ticket ON rma_cases (tenant, ticket_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rma_cases_asset ON rma_cases (tenant, asset_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_rma_cases_status_return_by ON rma_cases (tenant, status, return_by)');

  const fk = (constraint, columns, referencedTable, referencedColumns) =>
    ensureCompositeFk(knex, { table: 'rma_cases', constraint, columns, referencedTable, referencedColumns });
  await fk('rma_cases_ticket_fk', ['tenant', 'ticket_id'], 'tickets', ['tenant', 'ticket_id']);
  await fk('rma_cases_custody_fk', ['tenant', 'custody_id'], 'asset_custody', ['tenant', 'custody_id']);
  await fk('rma_cases_warranty_decided_by_fk', ['tenant', 'warranty_decided_by'], 'users', ['tenant', 'user_id']);
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
  ]) {
    await knex.raw(`ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS ${constraint}`);
  }
  // Claims in the new statuses cannot satisfy the old CHECK: fold them into the nearest legacy status.
  await knex.raw(`UPDATE rma_cases SET status = 'closed', closed_at = COALESCE(closed_at, now()) WHERE status = 'warranty_review'`);
  await knex.raw(`UPDATE rma_cases SET status = 'replaced' WHERE status = 'repaired'`);
  await knex.raw('ALTER TABLE rma_cases DROP CONSTRAINT IF EXISTS rma_cases_status_check');
  await knex.raw(`ALTER TABLE rma_cases ADD CONSTRAINT rma_cases_status_check CHECK (status = ANY (ARRAY[${list(OLD_STATUSES)}]))`);
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
