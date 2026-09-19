/**
 * Migration to create the credit_tracking table for the credit expiration system
 * Run: npx knex migrate:up 20250226125411_credit_tracking_table.cjs --knexfile knexfile.cjs --env migration
 * Rollback: npx knex migrate:down 20250226125411_credit_tracking_table.cjs --knexfile knexfile.cjs --env migration
 */

exports.up = async function(knex) {
  // Create the credit_tracking table
  await knex.schema.createTable('credit_tracking', (table) => {
    table.uuid('credit_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('company_id').notNullable();
    table.uuid('transaction_id').notNullable();
    table.decimal('amount', 10, 2).notNullable();
    table.decimal('remaining_amount', 10, 2).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expiration_date');
    table.boolean('is_expired').defaultTo(false);
    table.timestamp('updated_at');
    
    // Add foreign key constraints with tenant for CitusDB compatibility
    table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    table.foreign(['tenant', 'transaction_id']).references(['tenant', 'transaction_id']).inTable('transactions');
  });

  // Create indexes for performance
  await knex.schema.raw(`
    CREATE INDEX idx_credit_tracking_company_expiration 
    ON credit_tracking(tenant, company_id, is_expired, expiration_date);
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_credit_tracking_transaction 
    ON credit_tracking(tenant, transaction_id);
  `);

  // Add a comment to the table for documentation
  await knex.schema.raw(`
    COMMENT ON TABLE credit_tracking IS 'Tracks individual credits, their remaining amounts, and expiration dates';
  `);
};

exports.down = async function(knex) {
  // Drop the indexes first
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_credit_tracking_company_expiration`);
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_credit_tracking_transaction`);
  
  // Then drop the table
  await knex.schema.dropTableIfExists('credit_tracking');
};
