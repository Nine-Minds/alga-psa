/**
 * Add billing contact fields to companies table
 */
exports.up = function(knex) {
  return knex.schema.alterTable('companies', table => {
    // Add billing_contact_id referencing contacts table with composite foreign key
    table.uuid('billing_contact_id').nullable();
    table.foreign(['tenant', 'billing_contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts')
      .onDelete('SET NULL');
    
    // Add billing_email field
    table.string('billing_email').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('companies', table => {
    table.dropForeign(['tenant', 'billing_contact_id']);
    table.dropColumn('billing_contact_id');
    table.dropColumn('billing_email');
  });
};
