/**
 * Migration: Create Invoice Payments Table (CE)
 *
 * invoice_payments is written by CE paths (InvoiceService payments/refunds,
 * client pulse, recent-invoice summaries) as well as EE payment providers.
 * EE installs may already have the table from
 * ee/server/migrations/20251203120000_create_invoice_payments_table.cjs
 * (payment_id-only PK); that shape is detected and left untouched.
 */

async function hasCitus(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS available
  `);
  return Boolean(result.rows?.[0]?.available);
}

async function isDistributed(knex, tableName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
    ) AS distributed`,
    [tableName],
  );
  return Boolean(result.rows?.[0]?.distributed);
}

async function tenantInPrimaryKey(knex, tableName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ?
        AND tc.constraint_type = 'PRIMARY KEY'
        AND kcu.column_name = 'tenant'
    ) AS tenant_in_pk`,
    [tableName],
  );
  return Boolean(result.rows?.[0]?.tenant_in_pk);
}

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('invoice_payments');
  if (!exists) {
    await knex.schema.createTable('invoice_payments', (table) => {
      table.uuid('payment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
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
      table.primary(['tenant', 'payment_id']);
    });
  }

  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant ON invoice_payments(tenant)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(tenant, invoice_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_invoice_payments_reference ON invoice_payments(reference_number) WHERE reference_number IS NOT NULL'
  );

  // A pre-existing EE-shaped table (payment_id-only PK, FKs already in place)
  // must be left untouched: no distribution, no FK adds.
  const tenantInPk = await tenantInPrimaryKey(knex, 'invoice_payments');
  if (tenantInPk) {
    // Citus requires distribution before cross-table foreign keys are added.
    // On plain Postgres this is a no-op.
    if (await hasCitus(knex) && !await isDistributed(knex, 'invoice_payments')) {
      await knex.raw(
        `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'invoices')`,
        ['invoice_payments'],
      );
    }

    if (!await constraintExists(knex, 'invoice_payments', 'invoice_payments_tenant_foreign')) {
      await knex.raw(`
        ALTER TABLE invoice_payments
        ADD CONSTRAINT invoice_payments_tenant_foreign
        FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
      `);
    }
    if (!await constraintExists(knex, 'invoice_payments', 'invoice_payments_tenant_invoice_id_foreign')) {
      await knex.raw(`
        ALTER TABLE invoice_payments
        ADD CONSTRAINT invoice_payments_tenant_invoice_id_foreign
        FOREIGN KEY (tenant, invoice_id) REFERENCES invoices(tenant, invoice_id) ON DELETE CASCADE
      `);
    }
  }

  // Grant privileges to server user
  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE invoice_payments TO "${escapedUser}";
    `);
  }
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('invoice_payments');
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
