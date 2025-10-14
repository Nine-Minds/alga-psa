/**
 * Migration: Create Stripe Integration Tables
 *
 * This migration creates the database schema for Stripe integration Phase 1:
 * - License purchasing for AlgaPSA customers
 * - Designed to be vault-ready for Phase 2 multi-tenant billing
 *
 * Tables:
 * 1. stripe_accounts - Stripe account configuration per tenant
 * 2. stripe_customers - Maps AlgaPSA tenants to Stripe customers
 * 3. stripe_products - Product catalog (licenses, services, add-ons)
 * 4. stripe_prices - Pricing information for products
 * 5. stripe_subscriptions - Active subscriptions with quantity tracking
 * 6. stripe_webhook_events - Idempotency tracking for webhook events
 */

exports.up = async function(knex) {
    // 1. Create stripe_accounts table
    // Purpose: Store Stripe account configuration per tenant
    // Phase 1: One record for Nine Minds (master billing account)
    // Phase 2: Each customer tenant can add their own Stripe Connect account
    await knex.schema.createTable('stripe_accounts', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('stripe_account_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_account_external_id'); // Stripe's acct_xxx (for Connect, Phase 2)
        table.text('stripe_account_type').defaultTo('standard'); // standard, express, custom
        table.boolean('is_master_billing_account').defaultTo(false); // True for Nine Minds
        table.boolean('is_active').defaultTo(true);
        table.text('secret_key_vault_path'); // Path in vault (e.g., 'stripe/tenant_xxx/secret_key')
        table.text('webhook_secret_vault_path'); // Path in vault for webhook secret
        table.jsonb('configuration'); // Non-sensitive config only
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'stripe_account_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'stripe_account_external_id']);
    });

    // 2. Create stripe_customers table
    // Purpose: Map AlgaPSA tenants to Stripe customers
    // Phase 1: Maps AlgaPSA tenant → Nine Minds' Stripe customer
    // Phase 2: Can also map end-clients → Customer tenant's Stripe customer
    await knex.schema.createTable('stripe_customers', (table) => {
        table.uuid('tenant').notNullable(); // The AlgaPSA tenant being charged
        table.uuid('stripe_customer_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_customer_external_id').notNullable(); // Stripe's cus_xxx
        table.uuid('billing_tenant'); // Which tenant's Stripe account (for Phase 2)
        table.text('email').notNullable();
        table.text('name');
        table.jsonb('metadata');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'stripe_customer_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'stripe_customer_external_id']);

        // Note: billing_tenant FK will be added in Phase 2 when we implement Stripe Connect
        // table.foreign('billing_tenant').references('tenants.tenant');
    });

    // 3. Create stripe_products table
    // Purpose: Product catalog
    // Phase 1: One product: "AlgaPSA User License" owned by Nine Minds
    // Phase 2: Each tenant can define their own products/services
    await knex.schema.createTable('stripe_products', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('stripe_product_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_product_external_id').notNullable(); // Stripe's prod_xxx
        table.uuid('billing_tenant'); // Which tenant owns this product
        table.text('name').notNullable();
        table.text('description');
        table.text('product_type').notNullable(); // 'license', 'service', 'addon'
        table.boolean('is_active').defaultTo(true);
        table.jsonb('metadata');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'stripe_product_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'stripe_product_external_id']);
    });

    // 4. Create stripe_prices table
    // Purpose: Pricing for products
    await knex.schema.createTable('stripe_prices', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('stripe_price_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_price_external_id').notNullable(); // Stripe's price_xxx
        table.uuid('stripe_product_id').notNullable(); // FK to stripe_products
        table.integer('unit_amount').notNullable(); // Amount in cents
        table.text('currency').defaultTo('usd');
        table.text('recurring_interval'); // 'month', 'year', null for one-time
        table.integer('recurring_interval_count').defaultTo(1);
        table.boolean('is_active').defaultTo(true);
        table.jsonb('metadata');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'stripe_price_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'stripe_product_id']).references(['tenant', 'stripe_product_id']).inTable('stripe_products');
        table.unique(['tenant', 'stripe_price_external_id']);
    });

    // 5. Create stripe_subscriptions table
    // Purpose: Track active subscriptions
    // Links to tenants.licensed_user_count via quantity field
    await knex.schema.createTable('stripe_subscriptions', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('stripe_subscription_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_subscription_external_id').notNullable(); // Stripe's sub_xxx
        table.text('stripe_subscription_item_id'); // Stripe's si_xxx (for prorations)
        table.uuid('stripe_customer_id').notNullable(); // FK to stripe_customers
        table.uuid('stripe_price_id').notNullable(); // FK to stripe_prices
        table.text('status').notNullable(); // 'active', 'canceled', 'past_due'
        table.integer('quantity').defaultTo(1);
        table.timestamp('current_period_start', { useTz: true });
        table.timestamp('current_period_end', { useTz: true });
        table.timestamp('cancel_at', { useTz: true });
        table.timestamp('canceled_at', { useTz: true });
        table.jsonb('metadata');
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'stripe_subscription_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.foreign(['tenant', 'stripe_customer_id']).references(['tenant', 'stripe_customer_id']).inTable('stripe_customers');
        table.foreign(['tenant', 'stripe_price_id']).references(['tenant', 'stripe_price_id']).inTable('stripe_prices');
        table.unique(['tenant', 'stripe_subscription_external_id']);
    });

    // 6. Create stripe_webhook_events table
    // Purpose: Idempotency tracking for webhooks
    await knex.schema.createTable('stripe_webhook_events', (table) => {
        table.uuid('tenant').notNullable();
        table.uuid('webhook_event_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
        table.text('stripe_event_id').notNullable(); // Stripe's evt_xxx
        table.text('event_type').notNullable(); // 'checkout.session.completed', etc.
        table.jsonb('event_data');
        table.boolean('processed').defaultTo(false);
        table.text('processing_status').defaultTo('pending'); // 'pending', 'processing', 'completed', 'failed'
        table.text('processing_error');
        table.timestamp('processed_at', { useTz: true });
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

        table.primary(['tenant', 'webhook_event_id']);
        table.foreign('tenant').references('tenants.tenant');
        table.unique(['tenant', 'stripe_event_id']);
    });

    // Create indexes for common queries
    await knex.schema.raw('CREATE INDEX idx_stripe_customers_email ON stripe_customers(email)');
    await knex.schema.raw('CREATE INDEX idx_stripe_subscriptions_status ON stripe_subscriptions(tenant, status)');
    await knex.schema.raw('CREATE INDEX idx_stripe_webhook_events_processed ON stripe_webhook_events(tenant, processed, created_at)');
    await knex.schema.raw('CREATE INDEX idx_stripe_webhook_events_event_type ON stripe_webhook_events(tenant, event_type)');

    // Grant permissions to DB user if configured
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

exports.down = async function(knex) {
    // Drop tables in reverse order to respect foreign key constraints
    await knex.schema.dropTableIfExists('stripe_webhook_events');
    await knex.schema.dropTableIfExists('stripe_subscriptions');
    await knex.schema.dropTableIfExists('stripe_prices');
    await knex.schema.dropTableIfExists('stripe_products');
    await knex.schema.dropTableIfExists('stripe_customers');
    await knex.schema.dropTableIfExists('stripe_accounts');
};
