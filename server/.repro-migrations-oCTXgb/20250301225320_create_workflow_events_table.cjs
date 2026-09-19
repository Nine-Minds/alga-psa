exports.up = async function(knex) {
  // Create workflow_events table as the primary source of truth for event sourcing
  await knex.schema.createTable('workflow_events', (table) => {
    table.uuid('event_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.uuid('execution_id').notNullable();
    table.text('event_name').notNullable();
    table.text('event_type').notNullable();
    table.text('from_state').notNullable();
    table.text('to_state').notNullable();
    table.uuid('user_id');
    table.jsonb('payload');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Foreign keys
    table.foreign(['tenant', 'execution_id']).references(['tenant', 'execution_id']).inTable('workflow_executions');
    
    // Create index including tenant for CitusDB compatibility
    table.index(['tenant', 'execution_id']);
    
    // Create index for efficient event retrieval by type
    table.index(['tenant', 'event_type']);
    
    // Create index for chronological ordering
    table.index(['tenant', 'execution_id', 'created_at']);
  });
};

exports.down = async function(knex) {
  // Drop the workflow_events table
  await knex.schema.dropTableIfExists('workflow_events');
};
