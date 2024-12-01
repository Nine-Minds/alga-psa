exports.up = async function(knex) {
  // Drop the existing billing_cycle column and recreate it with the enum constraint
  await knex.schema.alterTable('companies', function(table) {
    table.dropColumn('billing_cycle');
  });

  await knex.schema.alterTable('companies', function(table) {
    table.enum('billing_cycle', ['weekly', 'bi-weekly', 'monthly', 'quarterly', 'semi-annually', 'annually'])
      .defaultTo('monthly')
      .notNullable();
  });

  // Set all existing records to monthly
  await knex('companies').update({ billing_cycle: 'monthly' });
};

exports.down = function(knex) {
  return knex.schema.alterTable('companies', function(table) {
    table.dropColumn('billing_cycle');
  });
};
