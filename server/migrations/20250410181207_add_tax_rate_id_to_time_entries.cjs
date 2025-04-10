
exports.up = function(knex) {
  return knex.schema.alterTable('time_entries', function(table) {
    // Add the tax_rate_id column, allowing null values
    table.uuid('tax_rate_id').nullable();
    // Add foreign key constraint referencing the tax_rates table
    table.foreign('tax_rate_id').references('tax_rate_id').inTable('tax_rates').onDelete('SET NULL');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('time_entries', function(table) {
    // Drop the foreign key constraint first (Knex might infer the name)
    // If this fails, we might need to specify the constraint name explicitly
    table.dropForeign('tax_rate_id');
    // Drop the column
    table.dropColumn('tax_rate_id');
  });
};
