/**
 * Migration to create the credit_reconciliation_reports table
 * This table will store detected discrepancies between expected and actual credit balances
 * without automatically making corrections.
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('credit_reconciliation_reports', function(table) {
      // Primary key
      table.uuid('report_id').primary().notNullable();
      
      // Foreign keys
      table.uuid('company_id').notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('resolution_transaction_id').nullable();
      
      // Balance information
      table.bigint('expected_balance').notNullable().comment('The calculated balance based on transaction history');
      table.bigint('actual_balance').notNullable().comment('The current balance stored in the company record');
      table.bigint('difference').notNullable().comment('The discrepancy amount (expected - actual)');
      
      // Timestamps
      table.timestamp('detection_date').notNullable().defaultTo(knex.fn.now());
      table.timestamp('resolution_date').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      
      // Resolution information
      table.string('status').notNullable().defaultTo('open').comment('Status of the report: open, in_review, resolved');
      table.string('resolution_user').nullable().comment('User ID who resolved the discrepancy');
      table.text('resolution_notes').nullable().comment('Notes about the resolution');
      
      // Indexes
      table.index(['company_id', 'tenant']);
      table.index(['status', 'tenant']);
      table.index(['detection_date', 'tenant']);
      
      // Foreign key constraints
      table.foreign(['company_id', 'tenant'])
        .references(['company_id', 'tenant'])
        .inTable('companies')
        .onDelete('CASCADE');
      
      table.foreign(['resolution_transaction_id', 'tenant'])
        .references(['transaction_id', 'tenant'])
        .inTable('transactions')
        .onDelete('SET NULL');
    })
    .raw(`
      CREATE TRIGGER update_credit_reconciliation_reports_updated_at
      BEFORE UPDATE ON credit_reconciliation_reports
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `);
};

exports.down = function(knex) {
  return knex.schema
    .raw(`DROP TRIGGER IF EXISTS update_credit_reconciliation_reports_updated_at ON credit_reconciliation_reports;`)
    .dropTableIfExists('credit_reconciliation_reports');
};