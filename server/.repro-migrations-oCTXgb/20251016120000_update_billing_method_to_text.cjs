/**
 * This migration updates the billing_method column in service_catalog and service_types tables:
 * 1. Drops ALL check constraints on billing_method columns
 * 2. Changes column type to TEXT with no constraints
 * 3. Migrates existing 'per_unit' values to 'usage'
 */

const MIGRATION_TENANT = 'migration:20251016120000_update_billing_method_to_text';
const BILLING_METHOD_NORMALIZATION_REASON = 'all-tenant billing method normalization';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Drop ALL possible check constraints on service_catalog
  await knex.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS billing_method_check');
  await knex.raw('ALTER TABLE service_catalog DROP CONSTRAINT IF EXISTS service_catalog_billing_method_check');

  // Drop ALL possible check constraints on service_types
  await knex.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS billing_method_check');
  await knex.raw('ALTER TABLE service_types DROP CONSTRAINT IF EXISTS service_types_billing_method_check');

  // Change service_catalog.billing_method to TEXT (no constraints)
  await knex.raw('ALTER TABLE service_catalog ALTER COLUMN billing_method TYPE TEXT');

  // Change service_types.billing_method to TEXT (no constraints)
  await knex.raw('ALTER TABLE service_types ALTER COLUMN billing_method TYPE TEXT');

  // NOW migrate existing data: change 'per_unit' to 'usage'
  await migrationDb.unscoped('service_catalog', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'per_unit')
    .update({ billing_method: 'usage' });

  await migrationDb.unscoped('service_types', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'per_unit')
    .update({ billing_method: 'usage' });

  const [{ count: serviceCatalogResidualCount }] = await migrationDb.unscoped('service_catalog', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'per_unit')
    .count('* as count');
  const [{ count: serviceTypesResidualCount }] = await migrationDb.unscoped('service_types', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'per_unit')
    .count('* as count');

  if (Number(serviceCatalogResidualCount) > 0 || Number(serviceTypesResidualCount) > 0) {
    throw new Error(
      `Billing method normalization failed; residual per_unit rows remain (service_catalog=${serviceCatalogResidualCount}, service_types=${serviceTypesResidualCount})`
    );
  }
};

exports.down = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Revert data migration: change 'usage' back to 'per_unit'
  await migrationDb.unscoped('service_catalog', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'usage')
    .update({ billing_method: 'per_unit' });

  await migrationDb.unscoped('service_types', BILLING_METHOD_NORMALIZATION_REASON)
    .where('billing_method', 'usage')
    .update({ billing_method: 'per_unit' });

  // Revert column type changes
  // Note: If there were specific enum constraints before, they would need to be re-added here
  await knex.schema.alterTable('service_catalog', function(table) {
    table.text('billing_method').notNullable().alter();
  });

  await knex.schema.alterTable('service_types', function(table) {
    table.text('billing_method').notNullable().alter();
  });
};
