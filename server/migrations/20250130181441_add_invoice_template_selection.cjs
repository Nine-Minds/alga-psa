exports.up = async function(knex) {
  // Add unique constraint to ensure only one default template per tenant
  await knex.raw(`
    CREATE UNIQUE INDEX unique_default_template_per_tenant
    ON invoice_templates (tenant)
    WHERE is_default = true
  `);

  await knex.schema.alterTable('companies', table => {
    table.uuid('invoice_template_id').nullable();
    table.foreign(['tenant', 'invoice_template_id'])
      .references(['tenant', 'template_id'])
      .inTable('invoice_templates')
      .onDelete('SET NULL');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('companies', table => {
    table.dropForeign(['tenant', 'invoice_template_id']);
    table.dropColumn('invoice_template_id');
  });

  await knex.raw(`
    DROP INDEX IF EXISTS unique_default_template_per_tenant
  `);
};
