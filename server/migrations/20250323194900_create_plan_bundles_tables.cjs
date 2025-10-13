/**
 * Migration to create Plan Bundles feature tables
 * This implements the schema for plan bundles, bundle contract lines, and company plan bundles
 */
exports.up = function(knex) {
  return knex.schema
    // Create plan_bundles table
    .createTable('plan_bundles', function(table) {
      // Foreign key to tenants
      table.uuid('tenant').notNullable();
      table.foreign('tenant').references('tenant').inTable('tenants');
      
      // Primary key
      table.uuid('bundle_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Bundle details
      table.string('bundle_name', 255).notNullable();
      table.text('bundle_description').nullable();
      table.boolean('is_active').defaultTo(true);
      
      // Timestamps
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Constraints
      table.unique(['tenant', 'bundle_id']);
      
      // Indexes
      table.index(['tenant']);
    })
    
    // Create bundle_billing_plans table
    .createTable('bundle_billing_plans', function(table) {
      // Foreign key to tenants
      table.uuid('tenant').notNullable();
      table.foreign('tenant').references('tenant').inTable('tenants');
      
      // Foreign key to plan_bundles
      table.uuid('bundle_id').notNullable();
      table.foreign(['tenant', 'bundle_id']).references(['tenant', 'bundle_id']).inTable('plan_bundles').onDelete('CASCADE');
      
      // Foreign key to billing_plans
      table.uuid('plan_id').notNullable();
      table.foreign(['tenant', 'plan_id']).references(['tenant', 'plan_id']).inTable('billing_plans').onDelete('CASCADE');
      
      // Additional fields
      table.integer('display_order').defaultTo(0);
      
      // Timestamp
      table.timestamp('created_at').defaultTo(knex.fn.now());
      
      // Primary key
      table.primary(['tenant', 'bundle_id', 'plan_id']);
      
      // Indexes
      table.index(['tenant']);
      table.index(['bundle_id']);
      table.index(['plan_id']);
    })
    
    // Create company_plan_bundles table
    .createTable('company_plan_bundles', function(table) {
      // Foreign key to tenants
      table.uuid('tenant').notNullable();
      table.foreign('tenant').references('tenant').inTable('tenants');
      
      // Primary key
      table.uuid('company_bundle_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Foreign key to companies
      table.uuid('company_id').notNullable();
      table.foreign(['tenant', 'company_id']).references(['tenant', 'company_id']).inTable('companies').onDelete('CASCADE');
      
      // Foreign key to plan_bundles
      table.uuid('bundle_id').notNullable();
      table.foreign(['tenant', 'bundle_id']).references(['tenant', 'bundle_id']).inTable('plan_bundles').onDelete('CASCADE');
      
      // Bundle assignment details
      table.timestamp('start_date').notNullable();
      table.timestamp('end_date').nullable();
      table.boolean('is_active').defaultTo(true);
      
      // Timestamps
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Constraints
      table.unique(['tenant', 'company_bundle_id']);
      
      // Indexes
      table.index(['tenant']);
      table.index(['company_id']);
      table.index(['bundle_id']);
    })
    
    // Add company_bundle_id to company_billing_plans
    .alterTable('company_billing_plans', function(table) {
      // Add company_bundle_id column
      table.uuid('company_bundle_id').nullable();
      
      // Add foreign key constraint
      table.foreign(['tenant', 'company_bundle_id'])
        .references(['tenant', 'company_bundle_id'])
        .inTable('company_plan_bundles')
        .onDelete('SET NULL');
      
      // Add index
      table.index(['company_bundle_id']);
    });
};

exports.down = function(knex) {
  return knex.schema
    // Remove company_bundle_id from company_billing_plans
    .alterTable('company_billing_plans', function(table) {
      table.dropForeign(['tenant', 'company_bundle_id']);
      table.dropIndex(['company_bundle_id']);
      table.dropColumn('company_bundle_id');
    })
    
    // Drop tables in reverse order
    .dropTableIfExists('company_plan_bundles')
    .dropTableIfExists('bundle_billing_plans')
    .dropTableIfExists('plan_bundles');
};