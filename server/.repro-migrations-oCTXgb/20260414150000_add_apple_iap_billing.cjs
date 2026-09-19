/**
 * Apple In-App Purchase billing support.
 *
 * Adds billing_source to tenants so we can distinguish Stripe-provisioned
 * tenants from Apple IAP-provisioned ones, and creates apple_iap_subscriptions
 * + apple_iap_notifications.
 *
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // ---- tenants.billing_source -------------------------------------------
  const hasBillingSource = await knex.schema.hasColumn('tenants', 'billing_source');
  if (!hasBillingSource) {
    await knex.schema.alterTable('tenants', (table) => {
      table.text('billing_source').notNullable().defaultTo('stripe');
    });
  }

  // ---- apple_iap_subscriptions ------------------------------------------
  const hasSubsTable = await knex.schema.hasTable('apple_iap_subscriptions');
  if (!hasSubsTable) {
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

      // Auto-renew state, tracked via DID_CHANGE_RENEWAL_STATUS notifications
      // and verified via the App Store Server API at upgrade time. A Stripe
      // upgrade is only allowed when this is false, so we can guarantee Apple
      // stops charging at the end of the current billing period.
      table.boolean('auto_renew_status').notNullable().defaultTo(true);
      table.timestamp('auto_renew_status_updated_at').nullable();

      // When the user upgrades to a Stripe-billed tier while their Apple sub
      // is still active, we create a Stripe subscription in trial mode (trial
      // aligned to expires_at) and store its external ID here. On EXPIRED,
      // the IAP webhook handler flips tenants.billing_source to 'stripe' and
      // clears this column. On DID_RENEW (user re-enabled auto-renew and was
      // charged again), the handler extends trial_end as a safety net.
      table.text('transition_stripe_subscription_external_id').nullable();

      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'original_transaction_id']);
      table.index(['status']);
      table.index(['expires_at']);
      table.index(['transition_stripe_subscription_external_id']);
    });
  }

  // Lookup index on original_transaction_id alone — used by the webhook /
  // restore handlers which receive an Apple transaction id and need to find
  // its tenant. Non-unique by design; see header comment.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS apple_iap_subscriptions_orig_tx_idx
      ON apple_iap_subscriptions (original_transaction_id);
  `);

  // ---- apple_iap_notifications ------------------------------------------
  const hasNotifTable = await knex.schema.hasTable('apple_iap_notifications');
  if (!hasNotifTable) {
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
  }

  // ---- Citus distribution -----------------------------------------------
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const subsDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'apple_iap_subscriptions'::regclass
      ) AS is_distributed;
    `);
    if (!subsDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(
        "SELECT create_distributed_table('apple_iap_subscriptions', 'tenant', colocate_with => 'tenants')"
      );
    }

    const notifDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'apple_iap_notifications'::regclass
      ) AS is_distributed;
    `);
    if (!notifDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_reference_table('apple_iap_notifications')");
    }
  } else {
    console.warn(
      '[add_apple_iap_billing] Skipping Citus distribution (functions unavailable)'
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('apple_iap_notifications');
  await knex.schema.dropTableIfExists('apple_iap_subscriptions');

  const hasBillingSource = await knex.schema.hasColumn('tenants', 'billing_source');
  if (hasBillingSource) {
    await knex.schema.alterTable('tenants', (table) => {
      table.dropColumn('billing_source');
    });
  }
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
