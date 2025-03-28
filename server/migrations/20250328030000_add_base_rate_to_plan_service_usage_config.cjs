
exports.up = function(knex) {
  return knex.schema.alterTable('plan_service_usage_config', function(table) {
    table.decimal('base_rate', 19, 4).nullable(); // Using decimal for precision, adjust precision/scale if needed
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('plan_service_usage_config', function(table) {
    table.dropColumn('base_rate');
  });
};
