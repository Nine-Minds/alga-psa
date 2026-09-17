'use strict';

/**
 * Rate provenance on contract_lines.
 *
 * Plan: docs/plans/2026-09-12-catalog-price-changes-reach-existing-contracts.md (§1).
 *
 * A nullable rate plus a boolean cannot express the state that dominates the
 * existing data: "there is a number here and nobody knows who put it there."
 * `rate_provenance` names that state so a catalog price change can reach exactly
 * the lines that deliberately follow the catalog and never a negotiated one.
 *
 *   inherited    must be NULL      follows the catalog, forever
 *   custom       must be NOT NULL  a human chose this
 *   unreviewed   must be NOT NULL  legacy row; bills as today; not yet classified
 *
 * Backfill is mechanical and money-neutral: a non-null stored rate becomes
 * `unreviewed` (bills identically to today), a null rate becomes `inherited`.
 */

const TABLE = 'contract_lines';
const COLUMN = 'rate_provenance';
const VALUE_CHECK = 'contract_lines_rate_provenance_check';
const RATE_CHECK = 'contract_lines_rate_provenance_rate_check';
const INDEX = 'idx_contract_lines_rate_provenance';

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
};

const hasIndex = async (knex, indexName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?
    ) AS present`,
    [indexName],
  );
  return Boolean(result.rows?.[0]?.present);
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  if (!(await hasColumn(knex, TABLE, COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} text`);
  }

  // Backfill every existing row. Idempotent: only touches unclassified rows.
  await knex.raw(`
    UPDATE ${TABLE}
    SET ${COLUMN} = CASE WHEN custom_rate IS NULL THEN 'inherited' ELSE 'unreviewed' END
    WHERE ${COLUMN} IS NULL
  `);

  if (!(await hasConstraint(knex, TABLE, VALUE_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${VALUE_CHECK}
      CHECK (${COLUMN} IS NULL OR ${COLUMN} IN ('custom', 'inherited', 'unreviewed'))
    `);
  }

  if (!(await hasConstraint(knex, TABLE, RATE_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${RATE_CHECK}
      CHECK (
        ${COLUMN} IS NULL
        OR (${COLUMN} = 'inherited' AND custom_rate IS NULL)
        OR (${COLUMN} IN ('custom', 'unreviewed') AND custom_rate IS NOT NULL)
      )
    `);
  }

  if (!(await hasIndex(knex, INDEX))) {
    await knex.raw(`CREATE INDEX ${INDEX} ON ${TABLE} (tenant, ${COLUMN})`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  if (await hasIndex(knex, INDEX)) {
    await knex.raw(`DROP INDEX ${INDEX}`);
  }
  if (await hasConstraint(knex, TABLE, RATE_CHECK)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${RATE_CHECK}`);
  }
  if (await hasConstraint(knex, TABLE, VALUE_CHECK)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${VALUE_CHECK}`);
  }
  if (await hasColumn(knex, TABLE, COLUMN)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }
};

// Citus-distributed table DDL must not run inside a transaction.
exports.config = { transaction: false };
