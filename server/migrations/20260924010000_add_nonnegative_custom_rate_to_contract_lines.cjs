'use strict';

/**
 * Recurring credit rates are authored as configured discounts or manual invoice
 * adjustments, never as a negative `contract_lines.custom_rate`. A negative
 * fixed line rate would bill with zero tax, be excluded from automatic discount
 * bases, and had no writer guard.
 *
 * This constraint makes "non-negative recurring rate" a database invariant for
 * every writer. Existing rows are surveyed first and any legacy negatives are
 * described in the migration log; when they exist the constraint is added
 * `NOT VALID` so the migration does not fail and new/updated rows are still
 * enforced. When the data is already clean the constraint is validated.
 */

const TABLE = 'contract_lines';
const COLUMN = 'custom_rate';
const CONSTRAINT = 'contract_lines_custom_rate_nonnegative';

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

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) {
    return;
  }

  const negatives = await knex(TABLE)
    .whereNotNull(COLUMN)
    .andWhere(COLUMN, '<', 0)
    .select('tenant', 'contract_line_id', COLUMN);

  if (negatives.length > 0) {
    console.warn(
      `[${CONSTRAINT}] Found ${negatives.length} legacy negative ${TABLE}.${COLUMN} row(s); ` +
        'they are left as-is and the new check is added NOT VALID (new writes are still rejected):',
    );
    for (const row of negatives.slice(0, 25)) {
      console.warn(`  tenant=${row.tenant} contract_line_id=${row.contract_line_id} ${COLUMN}=${row[COLUMN]}`);
    }
  }

  if (await hasConstraint(knex, TABLE, CONSTRAINT)) {
    return;
  }

  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${CONSTRAINT}
    CHECK (${COLUMN} IS NULL OR ${COLUMN} >= 0)
    NOT VALID
  `);

  if (negatives.length === 0) {
    await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT ${CONSTRAINT}`);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  if (await hasConstraint(knex, TABLE, CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${CONSTRAINT}`);
  }
};

// Citus-distributed table DDL must not run inside a transaction.
exports.config = { transaction: false };
