/**
 * Widen invoice_charge_details.quantity from integer to numeric(10,2).
 *
 * Hourly time charges now bill fractional hours (e.g. 4.25h) instead of
 * rounding each time entry up to a whole hour. invoice_charges.quantity and the
 * invoice_items view were already numeric(10,2) (migration 20250225165701), but
 * the detail/breakdown table — formerly invoice_item_details, renamed to
 * invoice_charge_details — was missed and still rejected fractional quantities
 * with `invalid input syntax for type integer: "4.25"` when persisting the
 * recurring service-period detail row.
 *
 * `rate` on this table stays integer: it stores whole cents.
 *
 * Citus note: invoice_charge_details is a distributed table. Force sequential
 * multi-shard modification first so the type change applies cleanly across all
 * shards within the migration transaction.
 */

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

exports.up = async function (knex) {
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }

  await knex.raw(
    'ALTER TABLE invoice_charge_details ALTER COLUMN quantity TYPE numeric(10,2) USING quantity::numeric(10,2)'
  );
};

exports.down = async function (knex) {
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }

  // Best-effort revert: fractional quantities are rounded back to whole units.
  await knex.raw(
    'ALTER TABLE invoice_charge_details ALTER COLUMN quantity TYPE integer USING round(quantity)::integer'
  );
};
