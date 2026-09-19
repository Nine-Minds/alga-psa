/**
 * Run migration: npx knex migrate:up 20241125125000_add_credit_allocations.cjs --knexfile knexfile.cjs
 * Rollback: npx knex migrate:down 20241125125000_add_credit_allocations.cjs --knexfile knexfile.cjs
 */
exports.up = async function(knex) {
    // Ensure required tables exist
    const hasTransactions = await knex.schema.hasTable('transactions');
    if (!hasTransactions) {
        throw new Error('transactions table must exist before creating credit_allocations');
    }

    const hasInvoices = await knex.schema.hasTable('invoices');
    if (!hasInvoices) {
        throw new Error('invoices table must exist before creating credit_allocations');
    }

    // Create credit_allocations table if it doesn't exist
    const hasCreditAllocations = await knex.schema.hasTable('credit_allocations');
    if (!hasCreditAllocations) {
        await knex.schema.createTable('credit_allocations', (table) => {
                table.uuid('allocation_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
                table.uuid('tenant').notNullable();
                table.uuid('transaction_id').notNullable();
                table.uuid('invoice_id').notNullable();
                table.decimal('amount', 10, 2).notNullable();
                table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
                
                table.foreign('transaction_id').references('transaction_id').inTable('transactions');
                table.foreign('invoice_id').references('invoice_id').inTable('invoices');
            }
        );
    }
}

exports.down = async function(knex) {
    await knex.schema.dropTable('credit_allocations');
};
