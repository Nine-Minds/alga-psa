'use strict';

/**
 * Line-scope pricing schedules and backstop overlaps at the DB.
 *
 * Plan: docs/plans/2026-09-12-catalog-price-changes-reach-existing-contracts.md §2.2.
 *
 * `contract_pricing_schedules` is keyed on `contract_id`, so one row changes
 * every line on the contract. Adding a nullable `contract_line_id` keeps the
 * existing rows' contract-wide meaning exactly (NULL = all lines) while letting
 * an override target a single line. The resolver already reads
 * `contract_line_id = <line> OR contract_line_id IS NULL`, most-specific first.
 *
 * The app-layer overlap check had drifted; the EXCLUDE constraint is the
 * backstop so an overlapping schedule cannot land even if a write path forgets
 * to check. NULL line scopes are coalesced to the nil UUID because exclusion
 * constraints treat NULLs as distinct, which would silently disable the guard
 * for contract-wide rows.
 */

const TABLE = 'contract_pricing_schedules';
const COLUMN = 'contract_line_id';
const LINE_FK = 'fk_contract_pricing_schedules_line';
const LINE_INDEX = 'idx_contract_pricing_schedules_line';
const NO_OVERLAP = 'contract_pricing_schedules_no_overlap';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

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

  // Required for `=` equality next to the range `&&` operator in the EXCLUDE.
  await knex.raw('CREATE EXTENSION IF NOT EXISTS btree_gist');

  if (!(await hasColumn(knex, TABLE, COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} uuid`);
  }

  if (!(await hasConstraint(knex, TABLE, LINE_FK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${LINE_FK}
      FOREIGN KEY (tenant, ${COLUMN})
      REFERENCES contract_lines(tenant, contract_line_id)
      ON DELETE CASCADE
    `);
  }

  if (!(await hasIndex(knex, LINE_INDEX))) {
    await knex.raw(
      `CREATE INDEX ${LINE_INDEX} ON ${TABLE} (tenant, contract_id, ${COLUMN})`,
    );
  }

  if (!(await hasConstraint(knex, TABLE, NO_OVERLAP))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${NO_OVERLAP}
      EXCLUDE USING gist (
        tenant WITH =,
        contract_id WITH =,
        COALESCE(${COLUMN}, '${NIL_UUID}'::uuid) WITH =,
        daterange(effective_date, end_date, '[)') WITH &&
      )
    `);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  if (await hasConstraint(knex, TABLE, NO_OVERLAP)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${NO_OVERLAP}`);
  }
  if (await hasIndex(knex, LINE_INDEX)) {
    await knex.raw(`DROP INDEX ${LINE_INDEX}`);
  }
  if (await hasConstraint(knex, TABLE, LINE_FK)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${LINE_FK}`);
  }
  if (await hasColumn(knex, TABLE, COLUMN)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }
};

// ALTER TABLE ... ADD COLUMN / ADD CONSTRAINT on distributed tables must not
// run inside a transaction.
exports.config = { transaction: false };
