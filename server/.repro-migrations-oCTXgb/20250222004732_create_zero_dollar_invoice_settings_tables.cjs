exports.up = function(knex) {
  return knex.schema
    .createTable('default_billing_settings', (table) => {
      table.uuid('tenant').notNullable();
      table.enu('zero_dollar_invoice_handling', ['normal', 'finalized']).notNullable().defaultTo('normal');
      table.boolean('suppress_zero_dollar_invoices').notNullable().defaultTo(false);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant']);
      table.foreign('tenant').references('tenant').inTable('tenants');
    })
    .createTable('company_billing_settings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('company_id').unique().notNullable();
      table.enu('zero_dollar_invoice_handling', ['normal', 'finalized']).notNullable();
      table.boolean('suppress_zero_dollar_invoices').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'company_id']);
      table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('company_billing_settings')
    .dropTableIfExists('default_billing_settings');
};
