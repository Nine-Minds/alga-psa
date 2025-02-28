/**
 * Add metadata column to credit_reconciliation_reports table
 */
exports.up = function(knex) {
  return knex.schema.alterTable('credit_reconciliation_reports', table => {
    table.jsonb('metadata').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('credit_reconciliation_reports', table => {
    table.dropColumn('metadata');
  });
};