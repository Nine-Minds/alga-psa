/**
 * Migration: Add currency_code to service_catalog
 *
 * This migration adds a currency_code column to the service_catalog table.
 * Each service's default_rate will now be explicitly associated with a currency.
 * All existing services are backfilled with 'USD' as the default currency.
 *
 * This is part of the multi-currency billing implementation where:
 * - Services define their rates in a specific currency
 * - Contract templates become currency-neutral (currency removed separately)
 * - Contracts inherit currency from clients
 * - Currency validation ensures services match contract currency
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add currency_code column to service_catalog
  await knex.schema.alterTable('service_catalog', (table) => {
    table.string('currency_code', 3).notNullable().defaultTo('USD');
  });

  // Backfill existing services with USD (already handled by default, but explicit for clarity)
  await knex('service_catalog')
    .whereNull('currency_code')
    .orWhere('currency_code', '')
    .update({ currency_code: 'USD' });

  console.log('Added currency_code column to service_catalog table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('service_catalog', (table) => {
    table.dropColumn('currency_code');
  });

  console.log('Removed currency_code column from service_catalog table');
};
