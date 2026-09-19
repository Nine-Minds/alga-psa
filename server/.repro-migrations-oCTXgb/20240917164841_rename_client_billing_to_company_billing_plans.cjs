exports.up = function(knex) {
  return knex.schema
    .renameTable('client_billing', 'company_billing_plans')
    .alterTable('company_billing_plans', function(table) {
      table.renameColumn('billing_id', 'company_billing_id');
      table.renameColumn('company_billing_id', 'company_billing_plan_id');
    })
    .then(() => {
      return knex('company_billing_plans').select('*');
    })
    .then((rows) => {
      // If there are any other column renames or data transformations needed, do them here
      // return knex.batchInsert('company_billing_plans', rows, 30);
    });
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('company_billing_plans', function(table) {
      table.renameColumn('company_billing_plan_id', 'company_billing_id');
      table.renameColumn('company_billing_id', 'billing_id');
    })
    .renameTable('company_billing_plans', 'client_billing')
    .then(() => {
      return knex('client_billing').select('*');
    })
    .then((rows) => {
      // If there were any other column renames or data transformations in the up migration, reverse them here
      // return knex.batchInsert('client_billing', rows, 30);
    });
};