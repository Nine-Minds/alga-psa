/**
 * Widen invoice line quantities from numeric(10,2) to numeric(14,6).
 *
 * Time charges bill whole minutes, so the hours on a line are rarely a
 * 2-decimal number: 5 minutes is 0.083333 h. With two decimals the invoice
 * shows 0.08 h × $125.00 = $10.42, and the exported pair no longer multiplies
 * back to the amount (QuickBooks 6070, support ticket alga-2026-0002643). Six
 * decimals keep quantity × rate within half a cent of the amount for any
 * hourly rate up to $10,000.
 *
 * invoice_items is a compatibility view over invoice_charges; Postgres refuses
 * to change the type of a column a view selects, so the view is dropped and
 * recreated around the change.
 *
 * Citus note: both tables are distributed. Force sequential multi-shard
 * modification so the type change applies cleanly across all shards within
 * the migration transaction.
 */

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

const alterQuantityColumns = async (knex, type, using) => {
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
  }

  await knex.raw('DROP VIEW IF EXISTS invoice_items');
  await knex.raw(`ALTER TABLE invoice_charges ALTER COLUMN quantity TYPE ${type} USING ${using}`);
  await knex.raw(`ALTER TABLE invoice_charge_details ALTER COLUMN quantity TYPE ${type} USING ${using}`);
  await knex.raw('CREATE VIEW invoice_items AS SELECT * FROM invoice_charges');
};

exports.up = async function (knex) {
  await alterQuantityColumns(knex, 'numeric(14,6)', 'quantity::numeric(14,6)');
};

exports.down = async function (knex) {
  // Best-effort revert: quantities are rounded back to two decimals.
  await alterQuantityColumns(knex, 'numeric(10,2)', 'round(quantity, 2)::numeric(10,2)');
};
