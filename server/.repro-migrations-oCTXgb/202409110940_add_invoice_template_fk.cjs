exports.up = async function(knex) {
    await knex.schema.alterTable('invoices', (table) => {
      // Add foreign key constraint
      table.foreign(['tenant', 'template_id'])
        .references(['tenant', 'template_id'])
        .inTable('invoice_templates')
        .onDelete('SET NULL');
    });
  };
  
  exports.down = async function(knex) {
    await knex.schema.alterTable('invoices', (table) => {
      // Remove the foreign key constraint
      table.dropForeign(['tenant', 'template_id']);
    });
  };