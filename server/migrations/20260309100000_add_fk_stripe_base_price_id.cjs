/**
 * Add foreign key from stripe_subscriptions.stripe_base_price_id to stripe_prices.stripe_price_id.
 *
 * The column was added in 20260305200000 without a FK constraint.
 * This aligns it with stripe_price_id which already references stripe_prices.
 */

exports.up = async function (knex) {
  // Check if FK already exists
  const fkExists = await knex.raw(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'stripe_subscriptions'
      AND constraint_name = 'stripe_subscriptions_stripe_base_price_id_foreign'
    LIMIT 1
  `);

  if (fkExists.rows.length === 0) {
    await knex.schema.alterTable('stripe_subscriptions', (table) => {
      table
        .foreign('stripe_base_price_id')
        .references('stripe_price_id')
        .inTable('stripe_prices')
        .onDelete('CASCADE');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('stripe_subscriptions', (table) => {
    table.dropForeign('stripe_base_price_id');
  });
};
