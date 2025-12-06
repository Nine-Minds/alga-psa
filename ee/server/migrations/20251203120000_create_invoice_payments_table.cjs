/**
 * Migration: Create Invoice Payments Table
 *
 * Creates the invoice_payments table for tracking payments against invoices.
 * This table is used by the payment provider system to record payments
 * received via Stripe and other payment providers.
 */

const ensureTable = async (knex, tableName, createFn) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await createFn();
  }
};

exports.up = async function up(knex) {
  await ensureTable(knex, 'invoice_payments', () =>
    knex.schema.createTable('invoice_payments', (table) => {
      table
        .uuid('payment_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .primary();
      table.uuid('tenant').notNullable();
      table.uuid('invoice_id').notNullable();
      table.bigInteger('amount').notNullable(); // Amount in cents
      table.string('payment_method', 100); // e.g., 'stripe', 'check', 'wire'
      table.timestamp('payment_date', { useTz: true }).defaultTo(knex.fn.now());
      table.string('reference_number', 255); // External reference (e.g., Stripe payment intent ID)
      table.text('notes');
      table.string('status', 50).defaultTo('completed'); // completed, pending, refunded, failed
      table.jsonb('metadata').defaultTo('{}');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
      table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices').onDelete('CASCADE');
    })
  );

  // Create indexes
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant ON invoice_payments(tenant)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(tenant, invoice_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_reference ON invoice_payments(reference_number) WHERE reference_number IS NOT NULL'
  );

  // Grant privileges to server user
  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE invoice_payments TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('invoice_payments');
};
