/**
 * Migration to add missing columns to transactions table for credit expiration functionality
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('transactions', table => {
    // Add expiration_date column for credit expiration functionality
    table.timestamp('expiration_date').nullable();
    
    // Add related_transaction_id for linking related transactions (e.g., credit expiration to original credit)
    table.uuid('related_transaction_id').nullable();
    
    // Add parent_transaction_id for transaction hierarchies
    table.uuid('parent_transaction_id').nullable();
    
    // Add metadata column for additional transaction data
    table.jsonb('metadata').nullable();
    
    // Add foreign key constraints
    table.foreign('related_transaction_id').references('transaction_id').inTable('transactions');
    table.foreign('parent_transaction_id').references('transaction_id').inTable('transactions');
    
    // Add index on expiration_date for better performance when querying for expired credits
    table.index(['tenant', 'expiration_date']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('transactions', table => {
    // Drop foreign key constraints first
    table.dropForeign(['related_transaction_id']);
    table.dropForeign(['parent_transaction_id']);
    
    // Drop index
    table.dropIndex(['tenant', 'expiration_date']);
    
    // Drop columns
    table.dropColumn('expiration_date');
    table.dropColumn('related_transaction_id');
    table.dropColumn('parent_transaction_id');
    table.dropColumn('metadata');
  });
};
