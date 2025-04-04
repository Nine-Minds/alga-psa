/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Add the rolled_over_hours column
    // Numeric type is suitable for potentially fractional hours, though integer might suffice if only whole hours roll over. Using numeric for flexibility.
    table.decimal('rolled_over_hours', 10, 2).notNullable().defaultTo(0.00).comment('Hours rolled over from the previous billing period.');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Remove the rolled_over_hours column
    table.dropColumn('rolled_over_hours');
  });
};
