/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  // Update the plan_id in bucket_usage based on the corresponding bucket_plan
  // Ensure tenant matching in the join and update condition
  return knex.raw(`
    UPDATE bucket_usage bu
    SET plan_id = bp.plan_id
    FROM bucket_plans bp
    WHERE bu.bucket_plan_id = bp.bucket_plan_id
      AND bu.tenant = bp.tenant;
  `);
  // Note: If there are bucket_usage records with bucket_plan_ids
  // that no longer exist in bucket_plans, their plan_id will remain NULL.
  // This is generally acceptable as the next migration will make plan_id NOT NULL
  // and add a foreign key, implicitly handling or erroring on orphaned records.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Set the plan_id column back to NULL
  return knex('bucket_usage').update({ plan_id: null });
};
