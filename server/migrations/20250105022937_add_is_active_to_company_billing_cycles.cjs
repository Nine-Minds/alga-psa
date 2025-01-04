exports.up = function(knex) {
  return knex.schema.alterTable('company_billing_cycles', function(table) {
    // Add is_active column with default true for existing records
    table.boolean('is_active').notNullable().defaultTo(true);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('company_billing_cycles', function(table) {
    table.dropColumn('is_active');
  });
};
