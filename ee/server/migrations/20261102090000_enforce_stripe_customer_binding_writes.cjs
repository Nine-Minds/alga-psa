/** Upgrade path for installations that already recorded the initial binding migration. */
const bindingMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');
exports.up = bindingMigration.up;
exports.down = async function down() {
  // The initial migration owns the schema and trigger lifecycle; this forward-only
  // compatibility migration intentionally leaves enforcement installed on rollback.
};
exports.config = { transaction: false };
