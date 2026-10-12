'use strict';

/**
 * `contract_line_service_fixed_config.base_rate_basis`: what a stored
 * `base_rate` MEANS.
 *
 * Plan: docs/plans/2026-10-12-fixed-line-base-rate-meaning-plan.md (§2.1, §3.3, §4).
 *
 *   per_unit  the member's contribution is base_rate x quantity
 *   share     the member's contribution is base_rate (its slice of the line fee)
 *
 * Steps, in order:
 *   1. add the nullable column
 *   2. move Fixed bundle `contract_line_service_configuration.custom_rate`
 *      allocations into `base_rate` (basis 'share', provenance 'custom'), then
 *      null the configuration value
 *   3. classify every remaining stored base_rate (shared SQL, see
 *      utils/fixedMemberBasisClassification.cjs)
 *   4. add the constraints
 *
 * `down` drops only the constraints and the column. The step-2 move is not
 * reversed: after it, the allocation lives where the engine reads it.
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

  // The move needs the classification-independent allocation set; the
  // statements below only touch rows whose fixed-config rate is still NULL.
  const movable = `
    clsc.configuration_type = 'Fixed'
    AND clsc.custom_rate IS NOT NULL
    AND COALESCE(sc.item_kind, 'service') <> 'product'
  `;

  // 2a. Existing fixed-config row with no rate yet: it takes the allocation.
  await knex.raw(`
    UPDATE ${TABLE} fc
    SET base_rate = clsc.custom_rate,
        ${COLUMN} = 'share',
        pricing_basis = COALESCE(fc.pricing_basis, 'bundle'),
        rate_provenance = 'custom'
    FROM contract_line_service_configuration clsc
    JOIN service_catalog sc ON sc.tenant = clsc.tenant AND sc.service_id = clsc.service_id
    WHERE fc.tenant = clsc.tenant
      AND fc.config_id = clsc.config_id
      AND fc.base_rate IS NULL
      AND fc.pricing_basis IS DISTINCT FROM 'unit'
      AND ${movable}
  `);

  // 2b. No fixed-config row at all: create it.
  await knex.raw(`
    INSERT INTO ${TABLE} (tenant, config_id, base_rate, pricing_basis, rate_provenance, ${COLUMN})
    SELECT clsc.tenant, clsc.config_id, clsc.custom_rate, 'bundle', 'custom', 'share'
    FROM contract_line_service_configuration clsc
    JOIN service_catalog sc ON sc.tenant = clsc.tenant AND sc.service_id = clsc.service_id
    WHERE ${movable}
      AND NOT EXISTS (
        SELECT 1 FROM ${TABLE} fc WHERE fc.tenant = clsc.tenant AND fc.config_id = clsc.config_id
      )
  `);

  // 2c. The allocation now lives in base_rate (or was superseded by an
  //     existing base_rate, which always won in the resolver): drop the copy.
  await knex.raw(`
    UPDATE contract_line_service_configuration clsc
    SET custom_rate = NULL
    FROM ${TABLE} fc, service_catalog sc
    WHERE fc.tenant = clsc.tenant
      AND fc.config_id = clsc.config_id
      AND sc.tenant = clsc.tenant
      AND sc.service_id = clsc.service_id
      AND fc.base_rate IS NOT NULL
      AND fc.pricing_basis IS DISTINCT FROM 'unit'
      AND ${movable}
  `);

  // 3. Classify what is left.
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
