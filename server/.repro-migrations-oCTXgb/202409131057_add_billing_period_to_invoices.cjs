exports.up = function(knex) {
    return knex.schema.table('invoices', function(table) {        
      table.date('billing_period_start').nullable();
      table.date('billing_period_end').nullable();
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.table('invoices', function(table) {
      table.dropColumn('billing_period_start');
      table.dropColumn('billing_period_end');
    });
  };
  