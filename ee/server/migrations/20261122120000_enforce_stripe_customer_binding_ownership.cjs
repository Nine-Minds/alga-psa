// The binding-table migration may already be recorded on deployed databases.
// Re-run its idempotent ownership enforcement so existing installations gain
// the same lock, backfill, conflict checks, and NOT VALID composite FK as
// fresh installs. Validation runs in the next, separately recorded migration
// (20261122120100_validate_stripe_customer_binding_ownership.cjs).
const bindingsMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');

exports.up = async function up(knex) {
  await bindingsMigration.enforceOwnership(knex);
};

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS ${bindingsMigration.ownerConstraint}`);
};

exports.config = { transaction: false };
