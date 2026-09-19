exports.up = async function(knex) {
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
    table.index(['tenant', 'company_id']); 
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    table.dropColumn('tenant');
  });
};
