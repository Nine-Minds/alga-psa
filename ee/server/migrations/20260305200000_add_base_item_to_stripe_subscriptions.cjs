/**
 * Add base fee item columns to stripe_subscriptions.
 *
 * Multi-item subscriptions have two items:
 *   - Per-user item (existing columns: stripe_subscription_item_id, stripe_price_id, quantity)
 *   - Base fee item (new columns: stripe_base_item_id, stripe_base_price_id)
 *
 * Legacy single-item subscriptions keep base columns NULL.
 */

exports.up = async function (knex) {
  const hasBaseItemId = await knex.schema.hasColumn('stripe_subscriptions', 'stripe_base_item_id');
  const hasBasePriceId = await knex.schema.hasColumn('stripe_subscriptions', 'stripe_base_price_id');

  await knex.schema.alterTable('stripe_subscriptions', (table) => {
    if (!hasBaseItemId) table.text('stripe_base_item_id').nullable();
    if (!hasBasePriceId) table.uuid('stripe_base_price_id').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('stripe_subscriptions', (table) => {
    table.dropColumn('stripe_base_item_id');
    table.dropColumn('stripe_base_price_id');
  });
};
