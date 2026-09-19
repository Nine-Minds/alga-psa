exports.up = async function(knex) {
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    // First drop existing primary key
    table.dropPrimary();
  });

  await knex.schema.alterTable('company_billing_cycles', (table) => {
    // Then add new primary key column and constraints
    table.uuid('billing_cycle_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.unique(['company_id', 'effective_date']);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('company_billing_cycles', (table) => {
    table.dropPrimary();
    table.dropUnique(['company_id', 'effective_date']);
    table.dropColumn('billing_cycle_id');
  });
};
