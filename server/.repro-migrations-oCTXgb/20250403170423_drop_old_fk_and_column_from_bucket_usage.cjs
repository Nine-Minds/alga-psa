/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Drop the old foreign key constraint referencing bucket_plans
    table.dropForeign(['tenant', 'bucket_plan_id'], 'bucket_usage_tenant_bucket_plan_id_foreign');

    // Drop the old bucket_plan_id column
    table.dropColumn('bucket_plan_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Re-add the bucket_plan_id column (nullable for now)
    table.uuid('bucket_plan_id').nullable();

    // Re-add the foreign key constraint
    // Note: This assumes the bucket_plans table still exists if rolling back.
    // Populating the re-added column would require a separate step or combining logic.
    table.foreign(['tenant', 'bucket_plan_id'], 'bucket_usage_tenant_bucket_plan_id_foreign')
         .references(['tenant', 'bucket_plan_id'])
         .inTable('bucket_plans');
  });
  // Consider adding logic here to re-populate bucket_plan_id if necessary during rollback,
  // potentially by joining bucket_usage.plan_id with billing_plans and then bucket_plans.
};
