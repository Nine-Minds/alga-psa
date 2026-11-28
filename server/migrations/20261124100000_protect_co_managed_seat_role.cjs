'use strict';

/**
 * Protect the co-managed Seat Technician role (plan pl-f68bfdf9, alga-2026-0003429).
 *
 *   1. `roles.managed_by` — the stable, tenant-scoped identity of a capability-owned role. The
 *      seat role is `managed_by = 'co-managed-seat'`, found by that, never by its name.
 *   2. `roles_managed_by_unique` — at most one role per (tenant, owner).
 *   3. `managed_role_reconciliation_findings` — what reconciliation could not decide, for an
 *      operator to resolve. No foreign keys, per house style, so it distributes on Citus.
 *   4. Reconciliation of deployed data (`utils/managedRoleReconciliation.cjs`): ownership is
 *      derived from live seat assignments and arrangements, the role's grants are reset to exactly
 *      the catalog set, legitimate assignments are kept, and ambiguity is reported and left alone.
 *
 * Tenant-scoped, idempotent and safe to re-run. Citus: `roles` is already distributed on
 * `tenant`; the new column and the unique index (which leads with `tenant`) propagate, the new
 * table is distributed colocated with `tenants`, and no statement writes by a non-distribution
 * column alone. `transaction: false` because create_distributed_table cannot run in a transaction.
 */

const FINDINGS = 'managed_role_reconciliation_findings';

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE roles ADD COLUMN IF NOT EXISTS managed_by text NULL');
  await knex.raw(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS roles_managed_by_unique
    ON roles (tenant, managed_by) WHERE managed_by IS NOT NULL
  `);

  if (!(await knex.schema.hasTable(FINDINGS))) {
    await knex.raw(`
      CREATE TABLE IF NOT EXISTS ${FINDINGS} (
        tenant uuid NOT NULL,
        finding_id uuid NOT NULL,
        owner text NOT NULL,
        kind text NOT NULL,
        finding_key text NOT NULL,
        detail text NOT NULL,
        role_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        detected_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz NULL,
        CONSTRAINT managed_role_reconciliation_findings_pkey PRIMARY KEY (tenant, finding_id)
      )
    `);
  }
  // One open finding per subject: a re-run never duplicates it.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS managed_role_reconciliation_findings_open_unique
    ON ${FINDINGS} (tenant, owner, finding_key) WHERE resolved_at IS NULL
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, FINDINGS);

  const { reconcileManagedRoles } = require('./utils/managedRoleReconciliation.cjs');
  const result = await reconcileManagedRoles(knex, { log: (message) => console.warn(message) });
  console.log(`[managed-role] reconciled ${result.reports.length} tenants: ${result.changed} changed, ${result.findings} findings`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(FINDINGS);
  await knex.raw('DROP INDEX IF EXISTS roles_managed_by_unique');
  await knex.raw('ALTER TABLE roles DROP COLUMN IF EXISTS managed_by');
};

exports.config = { transaction: false };
