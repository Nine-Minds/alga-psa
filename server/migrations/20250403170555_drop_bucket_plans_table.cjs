/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // Drop the now-obsolete bucket_plans table
  return knex.schema.dropTableIfExists('bucket_plans');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Recreate the bucket_plans table if rolling back
  return knex.schema.createTable('bucket_plans', function(table) {
    // Assuming the original structure based on previous context
    table.uuid('tenant').notNullable();
    table.uuid('bucket_plan_id').primary(['tenant', 'bucket_plan_id']).defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('plan_id').notNullable();
    table.integer('total_hours').notNullable();
    table.integer('overage_rate').nullable(); // Assuming overage rate was nullable
    table.string('billing_period').nullable(); // Assuming billing period was nullable string
    table.boolean('allow_rollover').defaultTo(false); // Assuming default was false

    // Add foreign key back to billing_plans
    table.foreign(['tenant', 'plan_id'], 'fk_bucket_plans_billing_plans')
         .references(['tenant', 'plan_id'])
         .inTable('billing_plans');

    // Add indexes if they existed (assuming standard indexes)
    table.index(['tenant', 'plan_id'], 'idx_bucket_plans_tenant_plan_id');
  });
  // Note: Re-populating this table on rollback would require data from before it was dropped.
};
