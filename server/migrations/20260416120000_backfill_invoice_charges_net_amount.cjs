/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.raw(`
    UPDATE invoice_charges
       SET net_amount = total_price - COALESCE(tax_amount, 0)
     WHERE net_amount IS NULL
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down() {
  // Backfill is not reversible without dropping data. No-op on rollback.
};
