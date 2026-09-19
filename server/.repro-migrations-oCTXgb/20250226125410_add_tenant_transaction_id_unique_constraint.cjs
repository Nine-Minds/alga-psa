/**
 * Migration to add a unique constraint on (tenant, transaction_id) in the transactions table
 * This is needed for the foreign key reference from the credit_tracking table
 */
exports.up = async function(knex) {
  // Add a unique constraint on (tenant, transaction_id)
  await knex.schema.raw(`
    ALTER TABLE transactions
    ADD CONSTRAINT transactions_tenant_transaction_id_unique
    UNIQUE (tenant, transaction_id);
  `);
  
  // Add a comment to explain the purpose of this constraint
  await knex.schema.raw(`
    COMMENT ON CONSTRAINT transactions_tenant_transaction_id_unique ON transactions
    IS 'Ensures uniqueness of transaction_id within each tenant, required for foreign key references';
  `);
};

exports.down = async function(knex) {
  // Remove the unique constraint
  await knex.schema.raw(`
    ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS transactions_tenant_transaction_id_unique;
  `);
};
