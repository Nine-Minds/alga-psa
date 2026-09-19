/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Add the new plan_id column, initially nullable
    table.uuid('plan_id').nullable();
    // Add index for performance, including tenant
    table.index(['tenant', 'plan_id'], 'idx_bucket_usage_tenant_plan_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('bucket_usage', function(table) {
    // Drop the index first
    table.dropIndex(['tenant', 'plan_id'], 'idx_bucket_usage_tenant_plan_id');
    // Drop the column
    table.dropColumn('plan_id');
  });
};
