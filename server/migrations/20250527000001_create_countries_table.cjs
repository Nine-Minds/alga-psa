/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Create countries table
  await knex.schema.createTable('countries', function(table) {
    table.string('code', 2).primary().comment('ISO 3166-1 alpha-2 country code');
    table.string('name', 100).notNullable().comment('Country name');
    table.boolean('is_active').defaultTo(true).comment('Whether country is available for selection');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Register as reference table for Citus (shared across all worker nodes)
  // Reference tables are replicated to all worker nodes for efficient joins
  await knex.raw("SELECT create_reference_table('countries')");

  console.log('✅ Created countries reference table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('countries');
};

// Disable transaction for Citus DB compatibility
// create_reference_table cannot run inside a transaction block
exports.config = { transaction: false };