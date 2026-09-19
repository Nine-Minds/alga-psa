/**
 * Migration: credit semantics reshape.
 *
 * 1. Restore immutable invoice totals. Credit application historically
 *    decremented invoices.total_amount while incrementing credit_applied by
 *    the same amount, so the original gross is recoverable:
 *    total_amount += credit_applied. From this migration on, application
 *    only moves credit_applied and balance due is derived
 *    (total_amount − credit_applied − payments).
 * 2. First-class credit-note identity: invoices.invoice_type
 *    ('standard' | 'credit_note' | 'prepayment') backfilled from
 *    is_prepayment and negative totals.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // 1. Restore original gross totals.
  await knex.raw(`
    UPDATE invoices
    SET total_amount = total_amount + credit_applied
    WHERE COALESCE(credit_applied, 0) > 0
  `);

  // 2. invoice_type column + backfill.
  const hasColumn = await knex.schema.hasColumn('invoices', 'invoice_type');
  if (!hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.string('invoice_type', 20).notNullable().defaultTo('standard'); // standard | credit_note | prepayment
    });
  }

  await knex.raw(`
    UPDATE invoices SET invoice_type = 'prepayment'
    WHERE is_prepayment = true AND invoice_type <> 'prepayment'
  `);
  await knex.raw(`
    UPDATE invoices SET invoice_type = 'credit_note'
    WHERE COALESCE(is_prepayment, false) = false
      AND total_amount < 0
      AND invoice_type <> 'credit_note'
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('invoices', 'invoice_type');
  if (hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.dropColumn('invoice_type');
    });
  }

  await knex.raw(`
    UPDATE invoices
    SET total_amount = total_amount - credit_applied
    WHERE COALESCE(credit_applied, 0) > 0
  `);
};

exports.config = { transaction: false };
