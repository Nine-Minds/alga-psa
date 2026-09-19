/**
 * Migration to create the workflow_event_processing table
 * This table tracks the processing status of workflow events in the distributed architecture
 */
exports.up = function(knex) {
  return knex.schema.createTable('workflow_event_processing', (table) => {
    // Primary key
    table.uuid('processing_id').primary();
    
    // References to workflow events
    table.uuid('event_id').notNullable().references('event_id').inTable('workflow_events').onDelete('CASCADE');
    table.uuid('execution_id').notNullable().references('execution_id').inTable('workflow_executions').onDelete('CASCADE');
    
    // Multi-tenancy support
    table.string('tenant').notNullable();
    
    // Processing status
    table.enum('status', [
      'pending',    // Event has been persisted but not yet published to Redis
      'published',  // Event has been published to Redis
      'processing', // Event is being processed by a worker
      'completed',  // Event has been successfully processed
      'failed',     // Event processing failed
      'retrying'    // Event is being retried after a failure
    ]).notNullable().defaultTo('pending');
    
    // Worker information
    table.string('worker_id').nullable();
    
    // Retry information
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('last_attempt').nullable();
    table.text('error_message').nullable();
    
    // Timestamps
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    
    // Indexes
    table.index('event_id');
    table.index('execution_id');
    table.index('tenant');
    table.index('status');
    table.index(['tenant', 'status']);
    table.index(['execution_id', 'status']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('workflow_event_processing');
};