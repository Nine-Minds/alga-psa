'use strict';

/**
 * `contract_line_service_fixed_config.base_rate_basis`: what a stored
 * `base_rate` MEANS.
 *
 * Plan: docs/plans/2026-10-12-fixed-line-base-rate-meaning-plan.md (§2.1, §4).
 *
 *   per_unit  the member's contribution is base_rate x quantity
 *   share     the member's contribution is base_rate (its slice of the line fee)
 *
 * Steps, in order:
 *   1. add the nullable column
 *   2. classify every stored base_rate (shared SQL, see
 *      utils/fixedMemberBasisClassification.cjs)
 *   3. add the constraints
 *
 * Plan §3.3 (moving Fixed clsc.custom_rate into base_rate as 'share') is
 * deliberately NOT done: the add-service/template paths store per-unit catalog
 * prices there, not shares.
 *
 * `down` drops only the constraints and the column.
 */

const { CLASSIFICATION_SQL } = require('./utils/fixedMemberBasisClassification.cjs');

const TABLE = 'contract_line_service_fixed_config';
const COLUMN = 'base_rate_basis';
const VALUE_CHECK = 'contract_line_service_fixed_config_base_rate_basis_check';
const PAIR_CHECK = 'contract_line_service_fixed_config_base_rate_basis_rate_check';
const SEAT_CHECK = 'contract_line_service_fixed_config_base_rate_basis_seat_check';

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

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }

  if (!(await hasColumn(knex, TABLE, COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} text`);
  }

  // Classify every stored base_rate.
  const pending = await knex.raw(CLASSIFICATION_SQL);
  const counts = {};
  const ambiguousLines = new Set();
  for (const row of pending.rows) {
    counts[`${row.base_rate_basis}/${row.reason}`] = (counts[`${row.base_rate_basis}/${row.reason}`] || 0) + 1;
    if (row.reason === 'ambiguous') ambiguousLines.add(`${row.tenant}:${row.contract_line_id}`);
  }
  console.info('[fixed_member_base_rate_basis] classification counts', JSON.stringify(counts));
  if (ambiguousLines.size > 0) {
    console.info(
      '[fixed_member_base_rate_basis] ambiguous lines kept per_unit (tenant:contract_line_id)',
      JSON.stringify([...ambiguousLines]),
    );
  }

  await knex.raw(`
    UPDATE ${TABLE} fc
    SET ${COLUMN} = c.base_rate_basis
    FROM (${CLASSIFICATION_SQL}) c
    WHERE fc.tenant = c.tenant
      AND fc.config_id = c.config_id
      AND fc.${COLUMN} IS NULL
      AND fc.base_rate IS NOT NULL
  `);

  // 4. Constraints.
  if (!(await hasConstraint(knex, TABLE, VALUE_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${VALUE_CHECK}
      CHECK (${COLUMN} IS NULL OR ${COLUMN} IN ('per_unit', 'share'))
    `);
  }
  if (!(await hasConstraint(knex, TABLE, PAIR_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${PAIR_CHECK}
      CHECK ((base_rate IS NULL) = (${COLUMN} IS NULL))
    `);
  }
  if (!(await hasConstraint(knex, TABLE, SEAT_CHECK))) {
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT ${SEAT_CHECK}
      CHECK (pricing_basis IS DISTINCT FROM 'unit' OR ${COLUMN} IS DISTINCT FROM 'share')
    `);
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return;
  }
  for (const name of [SEAT_CHECK, PAIR_CHECK, VALUE_CHECK]) {
    if (await hasConstraint(knex, TABLE, name)) {
      await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${name}`);
    }
  }
  if (await hasColumn(knex, TABLE, COLUMN)) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
  }
};

exports.config = { transaction: false };
