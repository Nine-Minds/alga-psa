exports.up = function(knex) {
    return knex.schema.createTable('company_locations', function(table) {
      table.uuid('location_id').primary();
      table.uuid('company_id').notNullable();
      table.string('address_line1').notNullable();
      table.string('address_line2');
      table.string('city').notNullable();
      table.string('state');
      table.string('postal_code');
      table.string('country').notNullable();
      table.string('tax_region').notNullable();
      table.timestamps(true, true);
      table.foreign('company_id').references('companies.company_id');
    });
  };
  
  exports.down = function(knex) {
    return knex.schema.dropTableIfExists('company_locations');
  };
  