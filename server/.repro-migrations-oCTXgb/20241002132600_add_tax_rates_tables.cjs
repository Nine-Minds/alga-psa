exports.up = function(knex) {
  return knex.schema
    .createTable('tax_rates', function(table) {
      table.uuid('tax_rate_id').primary();
      table.uuid('tenant').notNullable();
      table.string('region');
      table.decimal('tax_percentage', 5, 2).notNullable();
      table.text('description');
      table.date('start_date').notNullable();
      table.date('end_date');
      table.timestamps(true, true);

      table.foreign('tenant').references('tenants.tenant');
    })
    .createTable('company_tax_rates', function(table) {
      table.uuid('company_id').notNullable();
      table.uuid('tax_rate_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['company_id', 'tax_rate_id']);
      table.timestamps(true, true);

      table.foreign('company_id').references('companies.company_id');
      table.foreign('tax_rate_id').references('tax_rates.tax_rate_id');
      table.foreign('tenant').references('tenants.tenant');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('company_tax_rates')
    .dropTableIfExists('tax_rates');
};
