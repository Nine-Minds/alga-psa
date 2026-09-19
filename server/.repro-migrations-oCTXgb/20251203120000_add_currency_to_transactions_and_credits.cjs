/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const ensureDistributed = async (knex, tableName, distributionColumn) => {
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass LIMIT 1',
    [tableName]
  );
  if (rows.length > 0) return;
  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
};

// The currency backfill below correlates transactions with invoices and
// clients on tenant; on Citus all three must be distributed and colocated.
// invoices/transactions carry lone single-column uniques backing
// single-column FKs (themselves cross-tenant reference hazards) — convert
// those FKs to composite tenant form, drop the lone uniques, distribute.
// No-op on plain Postgres and on prod, which already has all of this.
const prepareCitusForCurrencyBackfill = async (knex) => {
  if (!(await isCitusEnabled(knex))) return;

  const singleColFks = [
    ['invoice_usage_records', 'invoice_usage_records_invoice_id_foreign', 'invoice_id', 'invoices', 'invoice_id'],
    ['credit_allocations', 'credit_allocations_invoice_id_foreign', 'invoice_id', 'invoices', 'invoice_id'],
    ['invoice_time_entries', 'invoice_time_entries_invoice_id_foreign', 'invoice_id', 'invoices', 'invoice_id'],
    ['credit_allocations', 'credit_allocations_transaction_id_foreign', 'transaction_id', 'transactions', 'transaction_id'],
  ];
  for (const [tbl, conname, col, refTbl, refCol] of singleColFks) {
    const { rows } = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [conname]);
    if (rows.length === 0) continue;
    await knex.raw(`ALTER TABLE ${tbl} DROP CONSTRAINT "${conname}"`);
    await knex.raw(`
      ALTER TABLE ${tbl} ADD CONSTRAINT "${conname}"
      FOREIGN KEY (tenant, ${col}) REFERENCES ${refTbl} (tenant, ${refCol})
    `);
  }

  for (const [tbl, uniq] of [['invoices', 'invoices_invoice_id_unique'], ['transactions', 'transactions_transaction_id_unique']]) {
    const { rows } = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ?', [uniq]);
    if (rows.length > 0) {
      await knex.raw(`ALTER TABLE ${tbl} DROP CONSTRAINT "${uniq}"`);
    }
  }

  await ensureDistributed(knex, 'invoice_templates', 'tenant');
  await ensureDistributed(knex, 'invoices', 'tenant');
  await ensureDistributed(knex, 'transactions', 'tenant');
  await ensureDistributed(knex, 'credit_tracking', 'tenant');
};

exports.up = async function(knex) {
  await prepareCitusForCurrencyBackfill(knex);
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
