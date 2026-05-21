/**
 * Drops the vestigial `billing_method` column from `service_types` and
 * `standard_service_types`.
 *
 * It was never load-bearing: charge type is driven by
 * `service_catalog.billing_method` plus the contract line configuration.
 * The service-type copy only ever served as a UI seed / broken filter proxy
 * and caused product/service type lists to diverge. `service_catalog`
 * (and its own `billing_method`) is intentionally left untouched.
 *
 * Citus note: `service_types` is distributed and `standard_service_types`
 * is a reference table; `ALTER TABLE ... DROP COLUMN` is propagated to all
 * nodes/shards automatically, so no Citus-specific migration is required.
 */

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS billing_method_check');
  await knex.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS service_types_billing_method_check');
  await knex.raw('ALTER TABLE service_types DROP COLUMN IF EXISTS billing_method');

  await knex.raw('ALTER TABLE standard_service_types DROP CONSTRAINT IF EXISTS billing_method_check');
  await knex.raw('ALTER TABLE standard_service_types DROP CONSTRAINT IF EXISTS standard_service_types_billing_method_check');
  await knex.raw('ALTER TABLE standard_service_types DROP COLUMN IF EXISTS billing_method');
};

exports.down = async function (knex) {
  // Best-effort restore only. The original per-row values are not recoverable;
  // re-add as nullable TEXT and backfill a neutral default.
  await knex.raw('ALTER TABLE standard_service_types ADD COLUMN IF NOT EXISTS billing_method TEXT');
  await knex.raw("UPDATE standard_service_types SET billing_method = 'usage' WHERE billing_method IS NULL");

  await knex.raw('ALTER TABLE service_types ADD COLUMN IF NOT EXISTS billing_method TEXT');
  await knex.raw("UPDATE service_types SET billing_method = 'usage' WHERE billing_method IS NULL");
};
