/**
 * Migration to add workflow_snapshots table for event sourcing optimization
 */
exports.up = function(knex) {
  return knex.schema.createTable('workflow_snapshots', function(table) {
    // Primary key
    table.string('snapshot_id').primary();
    
    // Foreign key to workflow_executions
    table.string('execution_id').notNullable();
    table.foreign('execution_id').references('workflow_executions.execution_id');
    
    // Multi-tenant support
    table.string('tenant').notNullable();
    
    // Snapshot version (timestamp)
    table.bigInteger('version').notNullable();
    
    // Workflow state
    table.string('current_state').notNullable();
    
    // Serialized data
    table.jsonb('data').notNullable();
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    // Indexes
    table.index(['execution_id', 'tenant']);
    table.index(['execution_id', 'version']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('workflow_snapshots');
};