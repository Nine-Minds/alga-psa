/**
 * Migration: Add service_prices table for multi-currency pricing
 *
 * This migration creates a service_prices table that allows each service
 * to have multiple currency/price pairs. This supports global MSPs who
 * offer the same services in multiple regions with different currencies.
 *
 * Schema:
 * - Each service can have multiple prices, one per currency
 * - The combination of (tenant, service_id, currency_code) is unique
 * - Existing default_rate values are migrated as USD prices
 *
 * This is part of the multi-currency billing implementation where:
 * - Services can have prices in multiple currencies
 * - Contract templates are currency-neutral
 * - Contracts inherit currency from clients
 * - Validation ensures services have a price in the contract's currency
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create service_prices table
  await knex.schema.createTable('service_prices', (table) => {
    table.uuid('price_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('service_id').notNullable();
    table.string('currency_code', 3).notNullable();
    table.integer('rate').notNullable(); // Amount in minor units (cents)
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Each service can only have one price per currency within a tenant
    table.unique(['tenant', 'service_id', 'currency_code']);
    
    // Foreign key referencing composite primary key (tenant, service_id) in service_catalog
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('CASCADE');
  });

  // Create indexes for efficient lookups
  await knex.schema.alterTable('service_prices', (table) => {
    table.index('service_id', 'idx_service_prices_service');
    table.index('currency_code', 'idx_service_prices_currency');
    table.index(['tenant', 'service_id'], 'idx_service_prices_tenant_service');
  });

  // Migrate existing default_rate values as USD prices
  // Only migrate services that have a non-null, positive default_rate
  await knex.raw(`
    INSERT INTO service_prices (tenant, service_id, currency_code, rate)
    SELECT tenant, service_id, 'USD', default_rate
    FROM service_catalog
    WHERE default_rate IS NOT NULL AND default_rate > 0
  `);

  const migratedCount = await knex('service_prices').count('* as count').first();
  console.log(`Created service_prices table and migrated ${migratedCount?.count || 0} existing rates as USD`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('service_prices');
  console.log('Dropped service_prices table');
};
