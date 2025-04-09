'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.createTable('tax_regions', (table) => {
    table.string('region_code', 255).notNullable();
    table.text('region_name').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('tenant').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Composite primary key (tenant, region_code) for CitusDB compatibility
    table.primary(['tenant', 'region_code']);

    // Foreign key to tenants table
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');

    // Index for tenant lookups (optional, often covered by PK)
    // table.index('tenant');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('tax_regions');
};