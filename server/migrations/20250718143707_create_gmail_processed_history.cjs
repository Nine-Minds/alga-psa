
exports.up = function(knex) {
  return knex.schema.createTable('gmail_processed_history', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('provider_id').notNullable();
    table.string('history_id').notNullable();
    table.string('message_id').nullable();
    table.timestamp('processed_at').defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    // Foreign key constraints
    table.foreign('tenant').references('tenant').inTable('tenants').onDelete('CASCADE');
    table.foreign(['provider_id', 'tenant']).references(['id', 'tenant']).inTable('email_providers').onDelete('CASCADE');
    
    // Unique constraint to prevent duplicate processing
    table.unique(['tenant', 'provider_id', 'history_id']);
    
    // Index for performance
    table.index(['tenant', 'provider_id', 'processed_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('gmail_processed_history');
};
