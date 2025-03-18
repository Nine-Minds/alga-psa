/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('usage_tracking', function(table) {
    table.uuid('billing_plan_id').nullable();
    // We need to reference the composite primary key (tenant, company_billing_plan_id)
    // Since we already have tenant in the usage_tracking table, we can create a composite foreign key
    table.foreign(['tenant', 'billing_plan_id']).references(['tenant', 'company_billing_plan_id']).inTable('company_billing_plans');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('usage_tracking', function(table) {
    table.dropForeign(['tenant', 'billing_plan_id']);
    table.dropColumn('billing_plan_id');
  });
};