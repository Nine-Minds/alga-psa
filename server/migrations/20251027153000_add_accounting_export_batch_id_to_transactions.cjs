/**
 * Migration: add accounting_export_batch_id to transactions for export audit linkage.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('transactions', 'accounting_export_batch_id');
  if (!hasColumn) {
    await knex.schema.alterTable('transactions', (table) => {
      table
        .uuid('accounting_export_batch_id')
        .nullable()
        .references('batch_id')
        .inTable('accounting_export_batches')
        .onDelete('SET NULL');
      table.index(['accounting_export_batch_id'], 'transactions_accounting_export_batch_idx');
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('transactions', 'accounting_export_batch_id');
  if (hasColumn) {
    await knex.schema.alterTable('transactions', (table) => {
      table.dropIndex(['accounting_export_batch_id'], 'transactions_accounting_export_batch_idx');
      table.dropColumn('accounting_export_batch_id');
    });
  }
};
