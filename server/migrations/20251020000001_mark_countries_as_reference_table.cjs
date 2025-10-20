/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Register countries table as reference table for Citus (shared across all worker nodes)
  // Reference tables are replicated to all worker nodes for efficient joins
  await knex.raw("SELECT create_reference_table('countries')");

  console.log('✅ Registered countries table as Citus reference table');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // No-op: Cannot undo reference table registration in Citus
  return Promise.resolve();
};

// Disable transaction for Citus DB compatibility
// create_reference_table cannot run inside a transaction block
exports.config = { transaction: false };