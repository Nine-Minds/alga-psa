'use strict';

/**
 * alga-2026-0002499: store each fixed-bundle member's tax decision on its
 * invoice_charge_fixed_details row so the saved-invoice tax pass
 * (calculateAndDistributeTax) matches the preview (computeFixedCharges).
 *
 * Both columns are nullable with no default and no backfill. NULL means a
 * legacy row: no member decision was stored, so the row inherits is_taxable /
 * tax_region from its parent invoice_charges row (previous behaviour).
 * Finalized invoices therefore never change their tax.
 *
 * Adding nullable columns to a Citus-distributed table is a metadata-only
 * ALTER; no wrapping transaction concerns beyond the default.
 */

exports.up = async function up(knex) {
  const hasIsTaxable = await knex.schema.hasColumn('invoice_charge_fixed_details', 'is_taxable');
  const hasTaxRegion = await knex.schema.hasColumn('invoice_charge_fixed_details', 'tax_region');
  if (hasIsTaxable && hasTaxRegion) return;

  await knex.schema.alterTable('invoice_charge_fixed_details', (table) => {
    if (!hasIsTaxable) table.boolean('is_taxable').nullable();
    if (!hasTaxRegion) table.text('tax_region').nullable();
  });
};

exports.down = async function down(knex) {
  const hasIsTaxable = await knex.schema.hasColumn('invoice_charge_fixed_details', 'is_taxable');
  const hasTaxRegion = await knex.schema.hasColumn('invoice_charge_fixed_details', 'tax_region');
  await knex.schema.alterTable('invoice_charge_fixed_details', (table) => {
    if (hasIsTaxable) table.dropColumn('is_taxable');
    if (hasTaxRegion) table.dropColumn('tax_region');
  });
};
