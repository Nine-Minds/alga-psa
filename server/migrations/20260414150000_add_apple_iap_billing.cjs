/**
 * Apple In-App Purchase billing support.
 *
 * Adds billing_source to tenants so we can distinguish Stripe-provisioned
 * tenants from Apple IAP-provisioned ones, and creates apple_iap_subscriptions
 * to mirror App Store Server Notification state.
 *
 * Citus rules:
 *   - tenant is part of every primary key
 *   - original_transaction_id is globally unique across tenants (Apple assigns it),
 *     so we enforce that with a separate unique index on just the column.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('tenants', (table) => {
    table.text('billing_source').notNullable().defaultTo('stripe');
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenants_billing_source_check'
      ) THEN
        ALTER TABLE tenants
          ADD CONSTRAINT tenants_billing_source_check
          CHECK (billing_source IN ('stripe', 'apple_iap', 'manual'));
      END IF;
    END$$;
  `);

  await knex.schema.createTable('apple_iap_subscriptions', (table) => {
    table.uuid('tenant').notNullable();
    table.text('original_transaction_id').notNullable();
    table.uuid('app_account_token').nullable();
    table.text('product_id').notNullable();
    table.text('bundle_id').notNullable();
    table.text('environment').notNullable(); // 'Production' | 'Sandbox'
    table.text('status').notNullable(); // 'active' | 'grace_period' | 'expired' | 'revoked' | 'refunded'
    table.timestamp('expires_at').nullable();
    table.timestamp('original_purchase_at').nullable();
    table.text('latest_transaction_id').nullable();
    table.text('latest_notification_type').nullable();
    table.text('latest_notification_subtype').nullable();
    table.timestamp('latest_notification_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'original_transaction_id']);
    table.index(['status']);
    table.index(['expires_at']);
  });

  // original_transaction_id is globally unique per Apple account, so we can
  // use it to find the tenant during restore / webhook dispatch without
  // knowing the tenant in advance.
  await knex.raw(`
    CREATE UNIQUE INDEX apple_iap_subscriptions_orig_tx_unique
      ON apple_iap_subscriptions (original_transaction_id);
  `);

  await knex.schema.createTable('apple_iap_notifications', (table) => {
    table.uuid('notification_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('notification_uuid').notNullable().unique();
    table.text('notification_type').notNullable();
    table.text('subtype').nullable();
    table.text('original_transaction_id').nullable();
    table.uuid('tenant').nullable();
    table.jsonb('payload').notNullable();
    table.timestamp('received_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at').nullable();
    table.text('processing_error').nullable();

    table.index(['original_transaction_id']);
    table.index(['received_at']);
    table.index(['processed_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('apple_iap_notifications');
  await knex.schema.dropTableIfExists('apple_iap_subscriptions');

  await knex.raw(`
    ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_billing_source_check;
  `);

  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('billing_source');
  });
};
