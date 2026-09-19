/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // No-op: This migration was merged into 20250916000001_add_missing_phone_codes.cjs
  return Promise.resolve();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // No-op: This migration was merged into 20250916000001_add_missing_phone_codes.cjs
  return Promise.resolve();
};