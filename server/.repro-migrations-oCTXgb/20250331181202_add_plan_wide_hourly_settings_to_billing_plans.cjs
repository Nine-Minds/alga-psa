/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('billing_plans', function(table) {
    table.boolean('enable_overtime').defaultTo(false);
    table.decimal('overtime_rate', 10, 2).nullable(); // Precision 10, Scale 2
    table.integer('overtime_threshold').nullable().defaultTo(40);
    table.boolean('enable_after_hours_rate').defaultTo(false);
    table.decimal('after_hours_multiplier', 5, 2).nullable().defaultTo(1.0); // Precision 5, Scale 2
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('billing_plans', function(table) {
    table.dropColumn('enable_overtime');
    table.dropColumn('overtime_rate');
    table.dropColumn('overtime_threshold');
    table.dropColumn('enable_after_hours_rate');
    table.dropColumn('after_hours_multiplier');
  });
};
