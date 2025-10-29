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
      table.uuid('accounting_export_batch_id').nullable();
      table
        .foreign(['tenant', 'accounting_export_batch_id'], 'transactions_tenant_accounting_export_batch_fk')
        .references(['tenant', 'batch_id'])
        .inTable('accounting_export_batches');
      table.index(['tenant', 'accounting_export_batch_id'], 'transactions_tenant_accounting_export_batch_idx');
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
      table.dropForeign(['tenant', 'accounting_export_batch_id'], 'transactions_tenant_accounting_export_batch_fk');
      table.dropIndex(['tenant', 'accounting_export_batch_id'], 'transactions_tenant_accounting_export_batch_idx');
      table.dropColumn('accounting_export_batch_id');
    });
  }
};
