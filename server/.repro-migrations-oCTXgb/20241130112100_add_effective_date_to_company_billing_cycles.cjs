exports.up = function(knex) {
  return knex.schema.alterTable('company_billing_cycles', function(table) {
    table.timestamp('effective_date').notNullable().defaultTo(knex.fn.now());
    table.index(['company_id', 'effective_date']);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('company_billing_cycles', function(table) {
    table.dropColumn('effective_date');
  });
};
