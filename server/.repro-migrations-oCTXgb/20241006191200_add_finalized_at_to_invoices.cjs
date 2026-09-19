exports.up = function(knex) {
  return knex.schema.table('invoices', function(table) {
    table.timestamp('finalized_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('invoices', function(table) {
    table.dropColumn('finalized_at');
  });
};