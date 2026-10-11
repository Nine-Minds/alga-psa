/** Existing Stripe readers/writers require the user-seat item identity. Some
 * installations already have it; fresh schemas must receive it as well. */
exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('stripe_subscriptions') ||
      await knex.schema.hasColumn('stripe_subscriptions', 'stripe_subscription_item_id')) return;
  await knex.schema.alterTable('stripe_subscriptions', table => {
    table.text('stripe_subscription_item_id').nullable();
  });
};

// Existing billing code also uses this field. Preserve provider identity on rollback.
exports.down = async function down() {};
