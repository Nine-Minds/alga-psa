'use strict';

/**
 * Distinguish operator credits from authored fixed discounts.
 *
 * A manual charge entered with a negative rate is persisted as a
 * discount-shaped credit (`is_discount = true`, `discount_type = 'fixed'`) so
 * it is excluded from the positive tax base, but its amount is derived from
 * `quantity × rate`. An authored fixed discount (the Add Discount flow) instead
 * stores a single amount that is independent of quantity (`-abs(rate)`).
 *
 * Both shapes are otherwise identical on the persisted row, so the draft
 * editor's fixed-discount recalculation could not tell them apart and dropped
 * the credit's quantity when the row was resaved. `is_manual_credit` records
 * the origin explicitly; authored fixed discounts keep the default false.
 *
 * Legacy rows are backfilled only when provable: a manual fixed discount whose
 * stored `net_amount` equals `quantity × unit_price` (rounded) was persisted
 * from a quantity × rate credit, not authored as a quantity-independent amount.
 */

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  if (!(await hasColumn(knex, 'invoice_charges', 'is_manual_credit'))) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.boolean('is_manual_credit').notNullable().defaultTo(false);
    });
  }

  // Backfill legacy quantity-derived credits. Authored fixed discounts store
  // `-abs(unit_price)` regardless of quantity, so they do not match this
  // predicate and keep the quantity-independent default.
  await knex.raw(`
    UPDATE invoice_charges
    SET is_manual_credit = true
    WHERE is_manual = true
      AND is_discount = true
      AND discount_type = 'fixed'
      AND quantity IS NOT NULL
      AND unit_price IS NOT NULL
      AND quantity <> 1
      AND net_amount = ROUND(quantity * unit_price)
  `);
};

exports.down = async function down(knex) {
  if (await hasColumn(knex, 'invoice_charges', 'is_manual_credit')) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.dropColumn('is_manual_credit');
    });
  }
};
