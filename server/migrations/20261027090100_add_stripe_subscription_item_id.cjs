/**
 * Stripe readers/writers use `stripe_subscriptions.stripe_subscription_item_id`
 * (the user-seat subscription item), but no migration created it. Some
 * installations already have the column; fresh schemas must receive it too.
 * Additive and idempotent; no backfill.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('stripe_subscriptions'))) return;
  await knex.raw('ALTER TABLE stripe_subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text');
};

exports.down = async function down(knex) {
  // Trade-off: this may drop data on installs that already had the column before this migration.
  if (!(await knex.schema.hasTable('stripe_subscriptions'))) return;
  await knex.raw('ALTER TABLE stripe_subscriptions DROP COLUMN IF EXISTS stripe_subscription_item_id');
};
