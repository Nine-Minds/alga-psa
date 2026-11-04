'use strict';

/**
 * Widen `discounts.value` from `decimal(10,2)` to `decimal(12,4)`.
 *
 * The column stores two meanings: a percentage is a fraction (`0.10` = 10%) and
 * a fixed discount is a decimal currency amount (`50.00` = $50). Two decimal
 * places truncated fractional percentages — 12.5% stored as `0.13` — so the
 * authoring form could not preserve a percentage like 12.5%.
 *
 * `decimal(10,4)` would keep the fraction but shorten the whole-number range
 * from 8 digits (99,999,999.99) to 6 digits (999,999.9999), so an existing
 * large fixed value could fail the (now validated) type change on deploy.
 * `decimal(12,4)` adds the fractional places without shrinking the prior
 * 8-digit integer range (max 99,999,999.9999). Every legacy value stays
 * readable and unchanged; no invoice data is rewritten.
 *
 * Citus note: force sequential multi-shard modification first when the table is
 * distributed, so the type change applies cleanly across shards.
 */

const TARGET_PRECISION = 12;
const TARGET_SCALE = 4;

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

const readDiscountValueType = async (knex) => {
  const result = await knex.raw(
    `SELECT numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_name = 'discounts' AND column_name = 'value'`,
  );
  return result.rows?.[0] ?? null;
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('discounts'))) {
    return;
  }

  // Data check: describe the largest existing value so a precision regression
  // is visible in the migration log rather than surfacing as a failed deploy.
  const extremes = await knex('discounts')
    .max({ maxValue: 'value' })
    .min({ minValue: 'value' })
    .first();
  const maxAbs = Math.max(
    Math.abs(Number(extremes?.maxValue ?? 0)),
    Math.abs(Number(extremes?.minValue ?? 0)),
  );
  const integerDigits = maxAbs > 0 ? String(Math.trunc(maxAbs)).length : 0;
  if (integerDigits > TARGET_PRECISION - TARGET_SCALE) {
    throw new Error(
      `discounts.value has ${integerDigits} integer digits, which does not fit decimal(${TARGET_PRECISION},${TARGET_SCALE})`,
    );
  }
  console.log(
    `[widen_discounts_value_precision] max |discounts.value| = ${maxAbs} (${integerDigits} integer digits); ` +
      `widening to decimal(${TARGET_PRECISION},${TARGET_SCALE})`,
  );

  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }
  await knex.raw(
    `ALTER TABLE discounts ALTER COLUMN value TYPE decimal(${TARGET_PRECISION},${TARGET_SCALE}) ` +
      `USING value::decimal(${TARGET_PRECISION},${TARGET_SCALE})`,
  );

  const applied = await readDiscountValueType(knex);
  if (
    Number(applied?.numeric_precision) !== TARGET_PRECISION ||
    Number(applied?.numeric_scale) !== TARGET_SCALE
  ) {
    throw new Error(
      `discounts.value did not widen to decimal(${TARGET_PRECISION},${TARGET_SCALE}) ` +
        `(saw precision=${applied?.numeric_precision} scale=${applied?.numeric_scale})`,
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('discounts'))) {
    return;
  }
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }
  await knex.raw(
    'ALTER TABLE discounts ALTER COLUMN value TYPE decimal(10,2) USING round(value::numeric, 2)::decimal(10,2)',
  );
};
