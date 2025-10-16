/**
 * This migration updates the billing_method column in service_catalog and service_types tables:
 * 1. Drops ALL check constraints on billing_method columns
 * 2. Changes column type to TEXT with no constraints
 * 3. Migrates existing 'per_unit' values to 'usage'
 */

exports.up = async function(knex) {
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
  await knex('service_catalog')
    .where('billing_method', 'per_unit')
    .update({ billing_method: 'usage' });

  await knex('service_types')
    .where('billing_method', 'per_unit')
    .update({ billing_method: 'usage' });
};

exports.down = async function(knex) {
  // Revert data migration: change 'usage' back to 'per_unit'
  await knex('service_catalog')
    .where('billing_method', 'usage')
    .update({ billing_method: 'per_unit' });

  await knex('service_types')
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
