/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Logic moved to seed file: 22a_ensure_tenant_service_types.cjs
  console.log('Migration 20250326202048: Logic moved to seed file 22a_ensure_tenant_service_types.cjs. Skipping migration step.');
  return Promise.resolve();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Logic moved to seed file: 22a_ensure_tenant_service_types.cjs
  // Down migration for data population is complex and often omitted or requires manual steps.
  console.warn('Migration 20250326202048: Down logic corresponds to seed file 22a_ensure_tenant_service_types.cjs and is not automatically reversible.');
  return Promise.resolve();
};
