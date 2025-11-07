/**
 * Migration: Align invoice tables with charge terminology and normalize currency fields.
 * 1. Rename invoice_items tables to invoice_charges equivalents and create a backward-compatible view.
 * 2. Add currency fields to invoices and convert transactions.amount to an integer (cents) representation.
 */

const tablesToRename = [
  { from: 'invoice_items', to: 'invoice_charges' },
  { from: 'invoice_item_details', to: 'invoice_charge_details' },
  { from: 'invoice_item_fixed_details', to: 'invoice_charge_fixed_details' }
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // -----------------------------------------------------------------------
  // 1. Rename invoice item tables to charge terminology.
  // -----------------------------------------------------------------------
  for (const { from, to } of tablesToRename) {
    const fromExists = await knex.schema.hasTable(from);
    const toExists = await knex.schema.hasTable(to);
    if (!fromExists || toExists) {
      continue;
    }
    await knex.schema.renameTable(from, to);
  }

  // Backward compatibility view for legacy queries referencing invoice_items.
  const invoiceChargesExists = await knex.schema.hasTable('invoice_charges');
  const legacyViewExists = await knex
    .select(knex.raw('1'))
    .from('pg_views')
    .where({ viewname: 'invoice_items' })
    .first();

  if (invoiceChargesExists) {
    if (!legacyViewExists) {
      await knex.raw(`
        CREATE VIEW invoice_items AS
        SELECT * FROM invoice_charges;
      `);
    } else {
      await knex.raw('CREATE OR REPLACE VIEW invoice_items AS SELECT * FROM invoice_charges;');
    }
  }

  // Ensure multi-tenant uniqueness remains explicit after the rename.
  if (invoiceChargesExists) {
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS invoice_charges_tenant_invoice_item_uidx
      ON invoice_charges (tenant, invoice_id, item_id)
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS invoice_charges_tenant_item_uidx
      ON invoice_charges (tenant, item_id)
    `);
  }

  const invoiceChargeDetailsExists = await knex.schema.hasTable('invoice_charge_details');
  if (invoiceChargeDetailsExists) {
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS invoice_charge_details_tenant_item_uidx
      ON invoice_charge_details (tenant, item_id, item_detail_id)
    `);

    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS invoice_charge_details_tenant_detail_uidx
      ON invoice_charge_details (tenant, item_detail_id)
    `);
  }

  // -----------------------------------------------------------------------
  // 2. Add currency metadata to invoices.
  // -----------------------------------------------------------------------
  const invoicesHasCurrencyCode = await knex.schema.hasColumn('invoices', 'currency_code');
  if (!invoicesHasCurrencyCode) {
    await knex.schema.alterTable('invoices', (table) => {
      table.string('currency_code', 3).notNullable().defaultTo('USD');
      table.integer('exchange_rate_basis_points').nullable().comment('Represents exchange rate * 10,000 when converting to base currency');
    });
  }

  // -----------------------------------------------------------------------
  // 3. Convert transactions.amount from decimal to integer cents.
  // -----------------------------------------------------------------------
  const hasAmountTemp = await knex.schema.hasColumn('transactions', 'amount_tmp');
  if (!hasAmountTemp) {
    await knex.schema.alterTable('transactions', (table) => {
      table.bigInteger('amount_tmp').nullable().comment('Temporary column storing amount in cents');
    });

    // Backfill amount_tmp with cents representation of existing amount.
    await knex('transactions').update({
      amount_tmp: knex.raw('ROUND(amount * 100)')
    });

    // Drop constraints/indexes touching amount if necessary (handled automatically if none).

    // Swap columns: drop old decimal amount, rename amount_tmp -> amount.
    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('amount');
    });

    await knex.schema.alterTable('transactions', (table) => {
      table.bigInteger('amount').notNullable().defaultTo(0);
    });

    await knex('transactions').update({
      amount: knex.raw('amount_tmp')
    });

    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('amount_tmp');
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // -----------------------------------------------------------------------
  // 1. Restore transactions.amount to decimal.
  // -----------------------------------------------------------------------
  const hasAmountDecimal = await knex.schema.hasColumn('transactions', 'amount_decimal');
  if (!hasAmountDecimal) {
    await knex.schema.alterTable('transactions', (table) => {
      table.decimal('amount_decimal', 14, 2).notNullable().defaultTo(0);
    });

    await knex('transactions').update({
      amount_decimal: knex.raw('amount / 100.0')
    });

    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('amount');
    });

    await knex.schema.alterTable('transactions', (table) => {
      table.decimal('amount', 14, 2).notNullable().defaultTo(0);
    });

    await knex('transactions').update({
      amount: knex.raw('amount_decimal')
    });

    await knex.schema.alterTable('transactions', (table) => {
      table.dropColumn('amount_decimal');
    });
  }

  // -----------------------------------------------------------------------
  // 2. Remove currency fields from invoices.
  // -----------------------------------------------------------------------
  const invoicesHasCurrencyCode = await knex.schema.hasColumn('invoices', 'currency_code');
  if (invoicesHasCurrencyCode) {
    await knex.schema.alterTable('invoices', (table) => {
      table.dropColumn('currency_code');
      table.dropColumn('exchange_rate_basis_points');
    });
  }

  // -----------------------------------------------------------------------
  // 3. Drop compatibility view and revert table names.
  // -----------------------------------------------------------------------
  await knex.raw('DROP VIEW IF EXISTS invoice_items;');

  await knex.raw('DROP INDEX IF EXISTS invoice_charge_details_tenant_item_uidx');
  await knex.raw('DROP INDEX IF EXISTS invoice_charges_tenant_invoice_item_uidx');
  await knex.raw('DROP INDEX IF EXISTS invoice_charge_details_tenant_detail_uidx');
  await knex.raw('DROP INDEX IF EXISTS invoice_charges_tenant_item_uidx');

  const reversedTables = tablesToRename.slice().reverse();
  for (const { from, to } of reversedTables) {
    const exists = await knex.schema.hasTable(to);
    if (exists) {
      await knex.schema.renameTable(to, from);
    }
  }
};
