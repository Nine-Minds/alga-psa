exports.up = function(knex) {
  return knex.schema
    .table('contracts', function(table) {
      table.string('currency_code', 3).defaultTo('USD').notNullable();
    })
    .table('contract_templates', function(table) {
      table.string('currency_code', 3).defaultTo('USD').notNullable();
    })
    .table('clients', function(table) {
      table.string('default_currency_code', 3).defaultTo('USD').notNullable();
    })
    .table('tax_rates', function(table) {
      table.string('currency_code', 3).nullable().comment('If set, this rate only applies to invoices in this currency. Null means universal.');
    });
};

exports.down = function(knex) {
  return knex.schema
    .table('contracts', function(table) {
      table.dropColumn('currency_code');
    })
    .table('contract_templates', function(table) {
      table.dropColumn('currency_code');
    })
    .table('clients', function(table) {
      table.dropColumn('default_currency_code');
    })
    .table('tax_rates', function(table) {
      table.dropColumn('currency_code');
    });
};
