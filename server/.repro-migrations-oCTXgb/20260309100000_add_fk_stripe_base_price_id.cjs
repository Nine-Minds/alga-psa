/**
 * Add foreign key from stripe_subscriptions.stripe_base_price_id to stripe_prices.stripe_price_id.
 *
 * The column was added in 20260305200000 without a FK constraint.
 * This aligns it with stripe_price_id which already references stripe_prices.
 */

exports.up = async function (knex) {
  // Check if the stripe_prices table exists and has a unique constraint on stripe_price_id.
  // The table is created by an EE migration and may not exist in CE deployments.
  const tableExists = await knex.schema.hasTable('stripe_prices');
  if (!tableExists) return;

  const uniqueExists = await knex.raw(`
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'stripe_prices'
      AND tc.constraint_type = 'UNIQUE'
      AND kcu.column_name = 'stripe_price_id'
    LIMIT 1
  `);
  if (uniqueExists.rows.length === 0) return;

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
