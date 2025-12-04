/**
 * Migration: Create Payment Provider Tables
 *
 * This migration creates the database schema for the abstract payment provider
 * architecture. These tables support Stripe and future payment providers for
 * invoice payments.
 *
 * Tables created:
 * - payment_provider_configs: Tenant payment provider configuration
 * - client_payment_customers: Client to payment provider customer mapping
 * - invoice_payment_links: Payment links for invoices
 * - payment_webhook_events: Webhook event tracking for idempotency
 *
 * The implementation is idempotent so it can run against databases where the
 * tables already exist (common in shared dev environments).
 */

const ensureTable = async (knex, tableName, createFn) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await createFn();
  }
};

/**
 * Payment provider configuration per tenant.
 * Stores credentials references and settings for each payment provider.
 */
const createPaymentProviderConfigs = (knex) =>
  knex.schema.createTable('payment_provider_configs', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('config_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.string('provider_type', 50).notNullable(); // 'stripe', 'paypal', etc.
    table.boolean('is_enabled').defaultTo(false);
    table.boolean('is_default').defaultTo(false);
    table.jsonb('configuration').defaultTo('{}'); // Provider-specific config
    table.text('credentials_vault_path'); // Path to secrets in vault
    table.text('webhook_secret_vault_path'); // Path to webhook secret
    table.jsonb('settings').defaultTo('{}'); // Payment settings (links in emails, etc.)
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.unique(['tenant', 'provider_type']);
  });

/**
 * Client to payment provider customer mapping.
 * Maps Alga PSA clients to their customer IDs in payment providers.
 */
const createClientPaymentCustomers = (knex) =>
  knex.schema.createTable('client_payment_customers', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('mapping_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.uuid('client_id').notNullable();
    table.string('provider_type', 50).notNullable();
    table.string('external_customer_id', 255).notNullable(); // stripe: cus_xxx
    table.string('email', 255);
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'mapping_id']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
    table.unique(['tenant', 'client_id', 'provider_type']);
  });

/**
 * Payment links for invoices.
 * Stores payment link URLs and their status for invoice payments.
 */
const createInvoicePaymentLinks = (knex) =>
  knex.schema.createTable('invoice_payment_links', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('link_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.uuid('invoice_id').notNullable();
    table.string('provider_type', 50).notNullable();
    table.string('external_link_id', 255).notNullable(); // stripe: cs_xxx (checkout session)
    table.text('url').notNullable();
    table.integer('amount').notNullable(); // cents
    table.string('currency', 3).notNullable().defaultTo('USD');
    table.string('status', 50).defaultTo('active'); // active, expired, completed, cancelled
    table.timestamp('expires_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.jsonb('metadata').defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'link_id']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices').onDelete('CASCADE');
    // Allow multiple payment links per invoice (e.g., expired ones replaced by new)
    // but track external_link_id uniqueness per tenant
    table.unique(['tenant', 'external_link_id']);
  });

/**
 * Payment webhook events.
 * Stores webhook events for idempotent processing and audit trail.
 */
const createPaymentWebhookEvents = (knex) =>
  knex.schema.createTable('payment_webhook_events', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('event_id')
      .defaultTo(knex.raw('gen_random_uuid()'))
      .notNullable();
    table.string('provider_type', 50).notNullable();
    table.string('external_event_id', 255).notNullable(); // stripe: evt_xxx
    table.string('event_type', 100).notNullable(); // e.g., 'checkout.session.completed'
    table.jsonb('event_data').notNullable();
    table.uuid('invoice_id'); // Nullable - may be determined during processing
    table.boolean('processed').defaultTo(false);
    table.string('processing_status', 50).defaultTo('pending'); // pending, processing, completed, failed
    table.text('processing_error');
    table.timestamp('processed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'event_id']);
    table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    // Note: No ON DELETE SET NULL - incompatible with Citus. Handle in application code.
    table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices');
    table.unique(['tenant', 'provider_type', 'external_event_id']);
  });

exports.up = async function up(knex) {
  // Create tables in order (respecting foreign key dependencies)
  await ensureTable(knex, 'payment_provider_configs', () => createPaymentProviderConfigs(knex));
  await ensureTable(knex, 'client_payment_customers', () => createClientPaymentCustomers(knex));
  await ensureTable(knex, 'invoice_payment_links', () => createInvoicePaymentLinks(knex));
  await ensureTable(knex, 'payment_webhook_events', () => createPaymentWebhookEvents(knex));

  // Create indexes (idempotent)
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_configs_tenant ON payment_provider_configs(tenant)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_configs_enabled ON payment_provider_configs(tenant, is_enabled) WHERE is_enabled = true'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_client_payment_customers_client ON client_payment_customers(tenant, client_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_client_payment_customers_external ON client_payment_customers(provider_type, external_customer_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_links_invoice ON invoice_payment_links(tenant, invoice_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_links_status ON invoice_payment_links(tenant, status) WHERE status = \'active\''
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed ON payment_webhook_events(tenant, processed, created_at)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_type ON payment_webhook_events(tenant, event_type)'
  );
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_invoice ON payment_webhook_events(invoice_id) WHERE invoice_id IS NOT NULL'
  );

  // Grant privileges to server user
  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`
      GRANT ALL PRIVILEGES ON TABLE payment_provider_configs TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE client_payment_customers TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE invoice_payment_links TO "${escapedUser}";
      GRANT ALL PRIVILEGES ON TABLE payment_webhook_events TO "${escapedUser}";
    `);
  }
};

exports.down = async function down(knex) {
  // Drop tables in reverse order (respecting foreign key dependencies)
  await knex.schema.dropTableIfExists('payment_webhook_events');
  await knex.schema.dropTableIfExists('invoice_payment_links');
  await knex.schema.dropTableIfExists('client_payment_customers');
  await knex.schema.dropTableIfExists('payment_provider_configs');
};
