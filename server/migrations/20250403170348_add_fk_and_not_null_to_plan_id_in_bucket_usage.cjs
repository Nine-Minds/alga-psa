/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Make the plan_id column non-nullable
    // This assumes the previous migration successfully populated all plan_ids
    // or that orphaned records are acceptable to fail here.
    table.uuid('plan_id').notNullable().alter();

    // Add the foreign key constraint referencing billing_plans
    // Ensure the constraint name is unique and descriptive
    table.foreign(['tenant', 'plan_id'], 'fk_bucket_usage_billing_plans')
         .references(['tenant', 'plan_id'])
         .inTable('billing_plans');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Drop the foreign key constraint first
    table.dropForeign(['tenant', 'plan_id'], 'fk_bucket_usage_billing_plans');

    // Make the plan_id column nullable again
    table.uuid('plan_id').nullable().alter();
  });
};
