'use strict';

/**
 * Widen `discounts.value` from `decimal(10,2)` to `decimal(10,4)`.
 *
 * The column stores two meanings: a percentage is a fraction (`0.10` = 10%) and
 * a fixed discount is a decimal currency amount (`50.00` = $50). Two decimal
 * places truncated fractional percentages — 12.5% stored as `0.13` — so the
 * authoring form could not preserve a percentage like 12.5%. Four places keep
 * whole and fractional percents exact while leaving every legacy value readable
 * (`0.10` stays `0.10`). The evaluator already reads the numeric value and
 * normalizes fractions, so no invoice data is rewritten.
 *
 * Citus note: force sequential multi-shard modification first when the table is
 * distributed, so the type change applies cleanly across shards.
 */

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('discounts'))) {
    return;
  }
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }
  await knex.raw(
    'ALTER TABLE discounts ALTER COLUMN value TYPE decimal(10,4) USING value::decimal(10,4)',
  );
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
