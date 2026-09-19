/**
 * Migration to add the 'credit_issuance_from_negative_invoice' type to the transactions table
 * check constraint.
 */
exports.up = function(knex) {
  return knex.schema.raw(`
    -- Drop existing constraint
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
    
    -- Create new constraint with the added type
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (
      type IN (
        'credit_application',
        'credit_issuance',
        'credit_adjustment',
        'credit_expiration',
        'credit_transfer',
        'credit_issuance_from_negative_invoice', -- New transaction type
        'payment',
        'partial_payment',
        'prepayment',
        'payment_reversal',
        'payment_failed',
        'invoice_generated',
        'invoice_adjustment',
        'invoice_cancelled',
        'late_fee',
        'early_payment_discount',
        'refund_full',
        'refund_partial',
        'refund_reversal',
        'service_credit',
        'price_adjustment',
        'service_adjustment',
        'billing_cycle_adjustment',
        'currency_adjustment',
        'tax_adjustment'
      )
    );
  `);
};

exports.down = function(knex) {
  return knex.schema.raw(`
    -- Drop the updated constraint
    ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
    
    -- Recreate the original constraint without the new type
    ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (
      type IN (
        'credit_application',
        'credit_issuance',
        'credit_adjustment',
        'credit_expiration',
        'credit_transfer',
        'payment',
        'partial_payment',
        'prepayment',
        'payment_reversal',
        'payment_failed',
        'invoice_generated',
        'invoice_adjustment',
        'invoice_cancelled',
        'late_fee',
        'early_payment_discount',
        'refund_full',
        'refund_partial',
        'refund_reversal',
        'service_credit',
        'price_adjustment',
        'service_adjustment',
        'billing_cycle_adjustment',
        'currency_adjustment',
        'tax_adjustment'
      )
    );
  `);
};
