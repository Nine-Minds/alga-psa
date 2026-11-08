'use strict';

/**
 * Step 3 of 3 for warranty review on rma_cases (alga-2026-0002683, card C5); see
 * 20261029130000_add_warranty_review_to_rma_cases (step 1) and 20261029130100_backfill_rma_case_warranty_review
 * (step 2).
 *
 * Runs outside a transaction so the indexes can be built CONCURRENTLY and VALIDATE CONSTRAINT holds only a
 * SHARE UPDATE EXCLUSIVE lock for its scan:
 *  - VALIDATE the re-stated CHECKs and the rma_number presence CHECK
 *  - SET NOT NULL on rma_number (metadata-only: the validated presence CHECK proves it, PostgreSQL 12+)
 *  - unique (tenant, rma_number) plus the lookup indexes
 *  - composite FKs to tickets, asset_custody (C4) and users
 *
 * Idempotent. Fails on the asset_custody FK when C4 is absent, on purpose.
 */

const { ensureCompositeFk } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const CHECKS = [
  'rma_cases_status_check',
  'rma_cases_warranty_outcome_check',
  'rma_cases_closed_reason_check',
  'rma_cases_denial_reason_check',
  'rma_cases_rma_number_present_check',
];

exports.up = async function up(knex) {
  for (const check of CHECKS) {
    await knex.raw(`ALTER TABLE rma_cases VALIDATE CONSTRAINT ${check}`);
  }
  // migration-lint: allow 3 - rma_number is backfilled by the previous migration and proven non-null by the validated rma_cases_rma_number_present_check, so SET NOT NULL is a catalog-only change with no table scan
  await knex.raw('ALTER TABLE rma_cases ALTER COLUMN rma_number SET NOT NULL');

  await knex.raw('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS rma_cases_tenant_rma_number_unique ON rma_cases (tenant, rma_number)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rma_cases_ticket ON rma_cases (tenant, ticket_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rma_cases_asset ON rma_cases (tenant, asset_id)');
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rma_cases_status_return_by ON rma_cases (tenant, status, return_by)');

  const fk = (constraint, columns, referencedTable, referencedColumns) =>
    ensureCompositeFk(knex, { table: 'rma_cases', constraint, columns, referencedTable, referencedColumns });
  await fk('rma_cases_ticket_fk', ['tenant', 'ticket_id'], 'tickets', ['tenant', 'ticket_id']);
  await fk('rma_cases_custody_fk', ['tenant', 'custody_id'], 'asset_custody', ['tenant', 'custody_id']);
  await fk('rma_cases_warranty_decided_by_fk', ['tenant', 'warranty_decided_by'], 'users', ['tenant', 'user_id']);
};

exports.down = async function down() {
  // Forward-only: step 1's down removes the FKs, indexes, constraints and columns this step created.
};
