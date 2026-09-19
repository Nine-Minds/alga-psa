exports.up = function(knex) {
  return knex.schema
    .alterTable('companies', function(table) {
      // Add unique constraint for company name within each tenant
      table.unique(['tenant', 'company_name']);
    })
    .alterTable('contacts', function(table) {
      // Add unique constraint for email within each tenant
      table.unique(['tenant', 'email']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('companies', function(table) {
      table.dropUnique(['tenant', 'company_name']);
    })
    .alterTable('contacts', function(table) {
      table.dropUnique(['tenant', 'email']);
    });
};
