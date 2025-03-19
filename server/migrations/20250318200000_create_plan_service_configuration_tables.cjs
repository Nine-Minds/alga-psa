/**
 * Migration to create the plan service configuration tables
 * This implements the normalized schema for service-specific configuration within plans
 */
exports.up = function(knex) {
  return knex.schema
    // Base configuration table
    .createTable('plan_service_configuration', function(table) {
      // Primary key
      table.uuid('config_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Foreign keys
      table.uuid('plan_id').notNullable();
      table.foreign(['plan_id', 'tenant']).references(['plan_id', 'tenant']).inTable('billing_plans').onDelete('CASCADE');
      
      table.uuid('service_id').notNullable();
      table.foreign(['service_id', 'tenant']).references(['service_id', 'tenant']).inTable('service_catalog').onDelete('CASCADE');
      
      // Configuration type
      table.string('configuration_type', 50).notNullable();
      
      // Common fields from plan_services
      table.decimal('custom_rate', 10, 2).nullable();
      table.integer('quantity').nullable();
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Constraints
      table.unique(['plan_id', 'service_id', 'tenant']);
      
      // Indexes
      table.index(['plan_id']);
      table.index(['service_id']);
      table.index(['tenant']);
    })
    
    // Fixed price configuration
    .createTable('plan_service_fixed_config', function(table) {
      // Primary key (same as config_id)
      table.uuid('config_id').primary();
      table.foreign('config_id').references('config_id').inTable('plan_service_configuration').onDelete('CASCADE');
      
      // Configuration fields
      table.boolean('enable_proration').notNullable().defaultTo(false);
      table.string('billing_cycle_alignment', 20).notNullable().defaultTo('start');
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
    })
    
    // Hourly configuration
    .createTable('plan_service_hourly_config', function(table) {
      // Primary key (same as config_id)
      table.uuid('config_id').primary();
      table.foreign('config_id').references('config_id').inTable('plan_service_configuration').onDelete('CASCADE');
      
      // Configuration fields
      table.integer('minimum_billable_time').notNullable().defaultTo(15);
      table.integer('round_up_to_nearest').notNullable().defaultTo(15);
      table.boolean('enable_overtime').notNullable().defaultTo(false);
      table.decimal('overtime_rate', 10, 2).nullable();
      table.integer('overtime_threshold').nullable();
      table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
      table.decimal('after_hours_multiplier', 5, 2).nullable();
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
    })
    
    // Usage-based configuration
    .createTable('plan_service_usage_config', function(table) {
      // Primary key (same as config_id)
      table.uuid('config_id').primary();
      table.foreign('config_id').references('config_id').inTable('plan_service_configuration').onDelete('CASCADE');
      
      // Configuration fields
      table.string('unit_of_measure', 50).notNullable().defaultTo('Unit');
      table.boolean('enable_tiered_pricing').notNullable().defaultTo(false);
      table.integer('minimum_usage').notNullable().defaultTo(0);
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
    })
    
    // Bucket configuration
    .createTable('plan_service_bucket_config', function(table) {
      // Primary key (same as config_id)
      table.uuid('config_id').primary();
      table.foreign('config_id').references('config_id').inTable('plan_service_configuration').onDelete('CASCADE');
      
      // Configuration fields
      table.integer('total_hours').notNullable();
      table.string('billing_period', 50).notNullable().defaultTo('monthly');
      table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
      table.boolean('allow_rollover').notNullable().defaultTo(false);
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Indexes
      table.index(['tenant']);
    })
    
    // Rate tiers for tiered pricing
    .createTable('plan_service_rate_tiers', function(table) {
      // Primary key
      table.uuid('tier_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Foreign key to configuration
      table.uuid('config_id').notNullable();
      table.foreign('config_id').references('config_id').inTable('plan_service_configuration').onDelete('CASCADE');
      
      // Tier range
      table.integer('min_quantity').notNullable();
      table.integer('max_quantity').nullable();
      
      // Rate for this tier
      table.decimal('rate', 10, 2).notNullable();
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Constraints
      table.unique(['config_id', 'min_quantity', 'tenant']);
      
      // Indexes
      table.index(['config_id']);
      table.index(['tenant']);
    })
    
    // User type rates for hourly services
    .createTable('user_type_rates', function(table) {
      // Primary key
      table.uuid('rate_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Foreign key to hourly configuration
      table.uuid('config_id').notNullable();
      table.foreign('config_id').references('config_id').inTable('plan_service_hourly_config').onDelete('CASCADE');
      
      // User type and rate
      table.string('user_type', 50).notNullable();
      table.decimal('rate', 10, 2).notNullable();
      
      // Tenant for CitusDB compatibility
      table.uuid('tenant').notNullable();
      
      // Timestamps
      table.timestamps(true, true);
      
      // Constraints
      table.unique(['config_id', 'user_type', 'tenant']);
      
      // Indexes
      table.index(['config_id']);
      table.index(['tenant']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('user_type_rates')
    .dropTableIfExists('plan_service_rate_tiers')
    .dropTableIfExists('plan_service_bucket_config')
    .dropTableIfExists('plan_service_usage_config')
    .dropTableIfExists('plan_service_hourly_config')
    .dropTableIfExists('plan_service_fixed_config')
    .dropTableIfExists('plan_service_configuration');
};