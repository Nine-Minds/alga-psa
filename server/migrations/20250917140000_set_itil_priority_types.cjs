/**
 * Migration to set priority_type for existing ITIL channels
 * Channels with category_type = 'itil' should also have priority_type = 'itil'
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex('channels')
    .where('category_type', 'itil')
    .update({ priority_type: 'itil' });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Don't automatically revert this as it might break existing functionality
  // If needed, manually update the channels
  return Promise.resolve();
};