exports.up = function(knex) {
  return knex.schema.table('invoices', function(table) {
    table.integer('subtotal').notNullable().defaultTo(0);
    table.integer('tax').notNullable().defaultTo(0);
  });
};

exports.down = function(knex) {
  return knex.schema.table('invoices', function(table) {
    table.dropColumn('subtotal');
    table.dropColumn('tax');
  });
};
