/**
 * Migration: Create Stripe Integration Tables
 *
 * This migration creates the database schema for Stripe integration Phase 1.
 * The implementation is idempotent so it can run against databases where the
 * tables already exist (common in shared dev environments).
 */

const ensureTable = async (knex, tableName, createFn) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await createFn();
  }
};

const createStripeAccounts = (knex) =>
  knex.schema.createTable('stripe_accounts', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('stripe_account_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_account_external_id');
    table.text('stripe_account_type').defaultTo('standard');
    table.boolean('is_master_billing_account').defaultTo(false);
    table.boolean('is_active').defaultTo(true);
    table.text('secret_key_vault_path');
    table.text('webhook_secret_vault_path');
    table.jsonb('configuration');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'stripe_account_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_account_external_id']);
  });

const createStripeCustomers = (knex) =>
  knex.schema.createTable('stripe_customers', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('stripe_customer_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_customer_external_id').notNullable();
    table.uuid('billing_tenant');
    table.text('email').notNullable();
    table.text('name');
    table.jsonb('metadata');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'stripe_customer_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_customer_external_id']);
    table.unique(['stripe_customer_id']);
  });

const createStripeProducts = (knex) =>
  knex.schema.createTable('stripe_products', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('stripe_product_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_product_external_id').notNullable();
    table.uuid('billing_tenant');
    table.text('name').notNullable();
    table.text('description');
    table.text('product_type').notNullable();
    table.boolean('is_active').defaultTo(true);
    table.jsonb('metadata');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'stripe_product_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_product_external_id']);
    table.unique(['stripe_product_id']);
  });

const createStripePrices = (knex) =>
  knex.schema.createTable('stripe_prices', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('stripe_price_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_price_external_id').notNullable();
    table.uuid('stripe_product_id').notNullable();
    table
      .foreign(['tenant', 'stripe_product_id'])
      .references(['tenant', 'stripe_product_id'])
      .inTable('stripe_products')
      .onDelete('CASCADE');
    table.integer('unit_amount').notNullable();
    table.text('currency').defaultTo('usd');
    table.text('billing_interval').defaultTo('month');
    table.integer('interval_count').defaultTo(1);
    table.boolean('is_active').defaultTo(true);
    table.jsonb('metadata');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'stripe_price_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_price_external_id']);
    table.unique(['stripe_price_id']);
    table.index(['tenant', 'stripe_product_id'], 'idx_stripe_prices_product');
  });

const createStripeSubscriptions = (knex) =>
  knex.schema.createTable('stripe_subscriptions', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('stripe_subscription_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_subscription_external_id').notNullable();
    table.uuid('stripe_customer_id').notNullable();
    table.uuid('stripe_price_id').notNullable();
    table
      .foreign(['tenant', 'stripe_customer_id'])
      .references(['tenant', 'stripe_customer_id'])
      .inTable('stripe_customers')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'stripe_price_id'])
      .references(['tenant', 'stripe_price_id'])
      .inTable('stripe_prices')
      .onDelete('CASCADE');
    table.integer('quantity').notNullable().defaultTo(1);
    table.text('status').defaultTo('active');
    table.timestamp('current_period_start', { useTz: true });
    table.timestamp('current_period_end', { useTz: true });
    table.timestamp('canceled_at', { useTz: true });
    table.jsonb('metadata');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'stripe_subscription_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_subscription_external_id']);
    table.index(['tenant', 'stripe_customer_id'], 'idx_stripe_subscriptions_customer');
  });

const createStripeWebhookEvents = (knex) =>
  knex.schema.createTable('stripe_webhook_events', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('webhook_event_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.text('stripe_event_id').notNullable();
    table.text('event_type').notNullable();
    table.jsonb('event_data');
    table.boolean('processed').defaultTo(false);
    table.text('processing_status').defaultTo('pending');
    table.text('processing_error');
    table.timestamp('processed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'webhook_event_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.unique(['tenant', 'stripe_event_id']);
  });

exports.up = async function up(knex) {
  await ensureTable(knex, 'stripe_accounts', () => createStripeAccounts(knex));
  await ensureTable(knex, 'stripe_customers', () => createStripeCustomers(knex));
  await ensureTable(knex, 'stripe_products', () => createStripeProducts(knex));
  await ensureTable(knex, 'stripe_prices', () => createStripePrices(knex));
  await ensureTable(knex, 'stripe_subscriptions', () => createStripeSubscriptions(knex));
  await ensureTable(knex, 'stripe_webhook_events', () => createStripeWebhookEvents(knex));

  // Indexes (idempotent)
  await knex.schema.raw('CREATE INDEX IF NOT EXISTS idx_stripe_customers_email ON stripe_customers(email)');
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status ON stripe_subscriptions(tenant, status)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed ON stripe_webhook_events(tenant, processed, created_at)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type ON stripe_webhook_events(tenant, event_type)'
  );

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE stripe_accounts TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE stripe_customers TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE stripe_products TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE stripe_prices TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE stripe_subscriptions TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE stripe_webhook_events TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('stripe_webhook_events');
  await knex.schema.dropTableIfExists('stripe_subscriptions');
  await knex.schema.dropTableIfExists('stripe_prices');
  await knex.schema.dropTableIfExists('stripe_products');
  await knex.schema.dropTableIfExists('stripe_customers');
  await knex.schema.dropTableIfExists('stripe_accounts');
};
