/**
 * Add billing_interval column to stripe_subscriptions.
 *
 * Tracks whether the subscription is monthly or annual.
 * Defaults to 'month' for backward compatibility with existing subscriptions.
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('stripe_subscriptions', 'billing_interval');
  if (!hasColumn) {
    await knex.schema.alterTable('stripe_subscriptions', (table) => {
      table.text('billing_interval').defaultTo('month').notNullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('stripe_subscriptions', (table) => {
    table.dropColumn('billing_interval');
  });
};
