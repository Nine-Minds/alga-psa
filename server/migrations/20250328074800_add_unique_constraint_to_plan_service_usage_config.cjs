/**
 * Migration to add a unique constraint on (config_id, tenant) to plan_service_usage_config
 */
exports.up = function(knex) {
  return knex.schema.alterTable('plan_service_usage_config', function(table) {
    // Add the unique constraint required for the upsert operation
    table.unique(['config_id', 'tenant'], { indexName: 'plan_service_usage_config_config_id_tenant_unique' });
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('plan_service_usage_config', function(table) {
    // Remove the unique constraint
    table.dropUnique(['config_id', 'tenant'], 'plan_service_usage_config_config_id_tenant_unique');
  });
};