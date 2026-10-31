/**
 * Per-component taxability for consolidated fixed bundles.
 *
 * A consolidated fixed parent charge is taxable if ANY component is, so tax
 * distribution (and discount-before-tax allocation) needs each detail's own
 * `is_taxable` and `tax_region`. Both are nullable: rows written before this
 * change keep NULL and are derived from the detail's service when tax is
 * recalculated. Idempotent: some environments already carry the columns.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  const hasTaxable = await knex.schema.hasColumn('invoice_charge_fixed_details', 'is_taxable');
  const hasRegion = await knex.schema.hasColumn('invoice_charge_fixed_details', 'tax_region');
  if (hasTaxable && hasRegion) return;
  await knex.schema.alterTable('invoice_charge_fixed_details', (table) => {
    if (!hasTaxable) table.boolean('is_taxable').nullable();
    if (!hasRegion) table.text('tax_region').nullable();
  });
};

exports.down = async function() {
  // Intentionally a no-op: other environments owned these columns before this migration.
};
