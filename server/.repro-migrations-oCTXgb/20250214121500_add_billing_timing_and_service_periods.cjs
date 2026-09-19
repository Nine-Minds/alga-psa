/**
 * DEPRECATED: This migration is a no-op as the functionality has been moved to
 * 20251025120000_add_billing_timing_metadata.cjs which handles the same changes
 * with correct SQL queries. This file is kept to maintain migration history.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // No-op: billing timing functionality is handled by later migration
};

/**
 * Rolls back billing timing metadata changes.
 * This is a no-op since the up function is a no-op.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // No-op: see up function comment
};
