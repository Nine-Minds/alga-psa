// The binding-table migration may already be recorded on deployed databases.
// Re-run its idempotent ownership enforcement so existing installations gain
// the same lock, validated composite FK, and conflict checks as fresh installs.
const bindingsMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');

exports.up = bindingsMigration.enforceOwnership;
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_binding_owner_fk');
};

exports.config = { transaction: false };
