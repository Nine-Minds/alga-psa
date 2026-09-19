exports.up = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    table.unique(['tenant', 'region', 'start_date', 'end_date']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tax_rates', function(table) {
    table.dropUnique(['tenant', 'region', 'start_date', 'end_date']);
  });
};