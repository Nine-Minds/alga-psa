/**
 * Migration to create the service_rate_tiers table
 * This table stores quantity-based pricing tiers for services
 */
exports.up = function(knex) {
  return knex.schema.createTable('service_rate_tiers', function(table) {
    // Primary key
    table.uuid('tier_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    
    // Foreign key to service_catalog
    table.uuid('service_id').notNullable();
    table.foreign(['service_id', 'tenant']).references(['service_id', 'tenant']).inTable('service_catalog').onDelete('CASCADE');
    
    // Tier range
    table.integer('min_quantity').notNullable();
    table.integer('max_quantity').nullable();
    
    // Rate for this tier
    table.decimal('rate', 10, 2).notNullable();
    
    // Tenant for CitusDB compatibility
    table.uuid('tenant').notNullable();
    
    // Timestamps
    table.timestamps(true, true);
    
    // Indexes
    table.index(['service_id', 'tenant']);
    table.index(['tenant']);
    
    // Ensure no overlapping ranges for the same service
    table.unique(['service_id', 'min_quantity', 'tenant']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('service_rate_tiers');
};
