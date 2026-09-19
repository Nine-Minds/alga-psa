exports.up = function(knex) {
  return knex.schema.createTable('company_billing_cycles', function(table) {
    table.uuid('company_id').primary().notNullable();
    table.string('billing_cycle').notNullable().defaultTo('monthly');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.foreign('company_id').references('companies.company_id').onDelete('CASCADE');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('company_billing_cycles');
};