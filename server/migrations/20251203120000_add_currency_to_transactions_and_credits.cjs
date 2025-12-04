/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add currency_code to transactions table
  const hasTransactionsCurrency = await knex.schema.hasColumn('transactions', 'currency_code');
  if (!hasTransactionsCurrency) {
    await knex.schema.alterTable('transactions', (table) => {
      table.string('currency_code', 3).defaultTo('USD').notNullable();
    });
    console.log('✓ Added currency_code to transactions table');
  }

  // Add currency_code to credit_tracking table
  const hasCreditTrackingCurrency = await knex.schema.hasColumn('credit_tracking', 'currency_code');
  if (!hasCreditTrackingCurrency) {
    await knex.schema.alterTable('credit_tracking', (table) => {
      table.string('currency_code', 3).defaultTo('USD').notNullable();
    });
    console.log('✓ Added currency_code to credit_tracking table');
  }

  // Backfill existing transactions with currency from related invoice or client default
  await knex.raw(`
    UPDATE transactions t
    SET currency_code = COALESCE(
      (SELECT i.currency_code FROM invoices i WHERE i.invoice_id = t.invoice_id AND i.tenant = t.tenant),
      (SELECT c.default_currency_code FROM clients c WHERE c.client_id = t.client_id AND c.tenant = t.tenant),
      'USD'
    )
    WHERE t.currency_code = 'USD'
  `);
  console.log('✓ Backfilled transactions currency_code from invoices/clients');

  // Backfill existing credit_tracking with currency from related transaction or client default
  await knex.raw(`
    UPDATE credit_tracking ct
    SET currency_code = COALESCE(
      (SELECT t.currency_code FROM transactions t WHERE t.transaction_id = ct.transaction_id AND t.tenant = ct.tenant),
      (SELECT c.default_currency_code FROM clients c WHERE c.client_id = ct.client_id AND c.tenant = ct.tenant),
      'USD'
    )
    WHERE ct.currency_code = 'USD'
  `);
  console.log('✓ Backfilled credit_tracking currency_code from transactions/clients');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasTransactionsCurrency = await knex.schema.hasColumn('transactions', 'currency_code');
  if (hasTransactionsCurrency) {
    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('currency_code');
    });
  }

  const hasCreditTrackingCurrency = await knex.schema.hasColumn('credit_tracking', 'currency_code');
  if (hasCreditTrackingCurrency) {
    await knex.schema.alterTable('credit_tracking', (table) => {
      table.dropColumn('currency_code');
    });
  }
};
