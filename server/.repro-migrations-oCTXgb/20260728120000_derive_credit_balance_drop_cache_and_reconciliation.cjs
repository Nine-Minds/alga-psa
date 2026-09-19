/**
 * Credit balance becomes a derived value (sum of non-expired
 * credit_tracking.remaining_amount) instead of a cached column, which makes
 * balance-vs-ledger reconciliation structurally impossible to need.
 *
 * - invoices.credit_expiration_date carries a prepayment's chosen credit
 *   expiration from creation to finalization, where the credit is now issued.
 * - clients.credit_balance (the cache) is dropped.
 * - credit_reconciliation_reports is dropped along with the feature.
 */
exports.up = async function up(knex) {
    await knex.schema.alterTable('invoices', (table) => {
        table.timestamp('credit_expiration_date', { useTz: true }).nullable();
    });

    await knex.schema.alterTable('clients', (table) => {
        table.dropColumn('credit_balance');
    });

    await knex.schema.dropTableIfExists('credit_reconciliation_reports');
};

exports.down = async function down(knex) {
    await knex.schema.alterTable('invoices', (table) => {
        table.dropColumn('credit_expiration_date');
    });

    await knex.schema.alterTable('clients', (table) => {
        table.bigInteger('credit_balance').notNullable().defaultTo(0);
    });

    // Best-effort rebuild of the cache from credit_tracking.
    await knex.raw(`
        UPDATE clients c
        SET credit_balance = COALESCE((
            SELECT SUM(ct.remaining_amount)
            FROM credit_tracking ct
            WHERE ct.tenant = c.tenant
              AND ct.client_id = c.client_id
              AND ct.is_expired = false
              AND (ct.expiration_date IS NULL OR ct.expiration_date > NOW())
        ), 0)
    `);

    // The reconciliation reports table is not restored; the feature is gone.
};
