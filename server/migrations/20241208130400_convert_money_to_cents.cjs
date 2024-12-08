/**
 * Convert money fields from decimal to integer cents
 * Run migration: npx knex migrate:up 20241208000000_convert_money_to_cents.cjs --knexfile knexfile.cjs
 * Rollback: npx knex migrate:down 20241208000000_convert_money_to_cents.cjs --knexfile knexfile.cjs
 */
exports.up = async function(knex) {
    // First convert existing values to cents (multiply by 100 and round)
    await knex.raw(`
        UPDATE invoices 
        SET credit_applied = ROUND(credit_applied * 100)
        WHERE credit_applied IS NOT NULL;
        
        UPDATE transactions 
        SET balance_after = ROUND(balance_after * 100),
            amount = ROUND(amount * 100)
        WHERE balance_after IS NOT NULL;
        
        UPDATE companies 
        SET credit_balance = ROUND(credit_balance * 100)
        WHERE credit_balance IS NOT NULL;
    `);

    // Then alter the column types to integer
    await knex.schema.alterTable('invoices', (table) => {
        table.integer('credit_applied').alter();
    });

    await knex.schema.alterTable('transactions', (table) => {
        table.integer('balance_after').alter();
        table.integer('amount').alter();
    });

    await knex.schema.alterTable('companies', (table) => {
        table.integer('credit_balance').alter();
    });
};

exports.down = async function(knex) {
    // Convert back to decimal by dividing by 100
    await knex.schema.alterTable('invoices', (table) => {
        table.decimal('credit_applied', 12, 2).alter();
    });

    await knex.schema.alterTable('transactions', (table) => {
        table.decimal('balance_after', 15, 2).alter();
        table.decimal('amount', 15, 2).alter();
    });

    await knex.schema.alterTable('companies', (table) => {
        table.decimal('credit_balance', 10, 2).alter();
    });

    await knex.raw(`
        UPDATE invoices 
        SET credit_applied = credit_applied / 100
        WHERE credit_applied IS NOT NULL;
        
        UPDATE transactions 
        SET balance_after = balance_after / 100,
        amount = amount / 100
        WHERE balance_after IS NOT NULL;
        
        UPDATE companies 
        SET credit_balance = credit_balance / 100
        WHERE credit_balance IS NOT NULL;
    `);
};
