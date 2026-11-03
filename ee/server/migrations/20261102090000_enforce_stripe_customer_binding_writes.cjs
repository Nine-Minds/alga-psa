/** Upgrade path for installations that already recorded the initial binding migration. */
const bindingMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');
exports.up = bindingMigration.up;
exports.down = async function down(knex) {
  // Leave the binding table and its owner index for their earlier migrations to remove.
  await knex.raw('ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_binding_owner_fk');
};
exports.config = { transaction: false };
