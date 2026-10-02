'use strict';

/**
 * Converge dev/CI with production on the contract_line_service_configuration child FKs
 * (alga0002268).
 *
 * Production carries NO ACTION composite FKs from three config child tables back to
 * contract_line_service_configuration; dev and CI databases do not. The wizard's draft-rebuild
 * path deleted the parent configuration rows without clearing these three children, so
 * finalizing a quote-converted draft raised 23503 in production while local and CI runs merely
 * leaked orphans and stayed green — the bug class could not fail a test.
 *
 * This migration adds the missing constraints under the Citus-aware conditional pattern from
 * 20260816010000_add_billing_profile_assignment_columns.cjs, using production's existing
 * constraint names so it is a no-op there. Pre-existing orphans are deleted first: with no
 * parent configuration row they are unreachable by every reader (each one joins through
 * contract_line_service_configuration), so removing them is money-neutral.
 */

const PARENT_TABLE = 'contract_line_service_configuration';

const CHILD_FKS = [
  {
    table: 'contract_line_service_fixed_config',
    constraint: 'contract_line_service_fixed_config_config_id_foreign',
  },
  {
    table: 'contract_line_service_hourly_configs',
    constraint: 'contract_line_service_hourly_configs_config_id_foreign',
  },
  {
    table: 'contract_line_service_rate_tiers',
    constraint: 'contract_line_service_rate_tiers_config_id_foreign',
  },
];

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
};

async function distributionState(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) AS distributed
    `, [tableName]);
    return Boolean(result.rows?.[0]?.distributed);
  } catch {
    return null;
  }
}

// LEVERAGE: pattern citus-fk-compat-probe — same probe as 20260816010000 and
// 20260415120200: add the FK when Citus is absent, or when both sides share a
// distribution state; skip rather than guess when they differ.
async function compatibleForConfigFk(knex, tableName) {
  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS has_citus
    `);
    if (!Boolean(citusCheck.rows?.[0]?.has_citus)) return true;
    const childDistributed = await distributionState(knex, tableName);
    const parentDistributed = await distributionState(knex, PARENT_TABLE);
    return childDistributed === parentDistributed;
  } catch {
    return true;
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(PARENT_TABLE))) {
    return;
  }

  for (const { table, constraint } of CHILD_FKS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await hasConstraint(knex, table, constraint)) continue;

    // The orphan DELETE below correlates child and parent on a subquery;
    // Citus can only push that down when both sides share a distribution
    // state (same as the FK itself). Probe before deleting, not just before
    // adding the constraint - a distributed/local mismatch makes the DELETE
    // itself fail, not only the ALTER TABLE.
    if (!(await compatibleForConfigFk(knex, table))) {
      console.log(
        `${table} and ${PARENT_TABLE} have incompatible distribution - skipping cleanup and FK ${constraint}`
      );
      continue;
    }

    // Unreachable rows: every reader of these tables joins through the parent
    // configuration, so a child without one can never be priced or invoiced.
    const deleted = await knex.raw(`
      DELETE FROM ${table} AS child
      WHERE NOT EXISTS (
        SELECT 1 FROM ${PARENT_TABLE} AS parent
        WHERE parent.tenant = child.tenant
          AND parent.config_id = child.config_id
      )
    `);
    if (deleted?.rowCount) {
      console.log(`  ✓ Removed ${deleted.rowCount} orphaned ${table} row(s)`);
    }

    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${constraint}
      FOREIGN KEY (tenant, config_id)
      REFERENCES ${PARENT_TABLE} (tenant, config_id)
    `);
  }
};

exports.down = async function down(knex) {
  for (const { table, constraint } of CHILD_FKS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (await hasConstraint(knex, table, constraint)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
  }
};
