exports.up = async function(knex) {
  // Create workflow_action_results table to track the results of executed actions with idempotency keys
  await knex.schema.createTable('workflow_action_results', (table) => {
    table.uuid('result_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.uuid('event_id').notNullable();
    table.uuid('execution_id').notNullable();
    table.text('action_name').notNullable();
    table.text('action_path');
    table.text('action_group');
    table.jsonb('parameters');
    table.jsonb('result');
    table.boolean('success').notNullable();
    table.text('error_message');
    table.text('idempotency_key').notNullable();
    table.boolean('ready_to_execute').defaultTo(true);
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Foreign keys
    table.foreign(['tenant', 'execution_id']).references(['tenant', 'execution_id']).inTable('workflow_executions');
    
    // Create index for efficient action result retrieval
    table.index(['tenant', 'event_id']);
    table.index(['tenant', 'idempotency_key']);
  });

  // Create workflow_action_dependencies table to track dependencies between actions
  await knex.schema.createTable('workflow_action_dependencies', (table) => {
    table.uuid('dependency_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.uuid('execution_id').notNullable();
    table.uuid('event_id').notNullable();
    table.uuid('action_id').notNullable();
    table.uuid('depends_on_id').notNullable();
    table.text('dependency_type').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Foreign keys
    table.foreign(['tenant', 'execution_id']).references(['tenant', 'execution_id']).inTable('workflow_executions');
    table.foreign('action_id').references('result_id').inTable('workflow_action_results');
    table.foreign('depends_on_id').references('result_id').inTable('workflow_action_results');
    
    // Create indexes for efficient dependency retrieval
    table.index(['tenant', 'action_id']);
    table.index(['tenant', 'depends_on_id']);
  });

  // Create workflow_sync_points table for tracking join operations
  await knex.schema.createTable('workflow_sync_points', (table) => {
    table.uuid('sync_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.uuid('execution_id').notNullable();
    table.uuid('event_id').notNullable();
    table.text('sync_type').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.integer('total_actions').notNullable();
    table.integer('completed_actions').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    
    // Foreign keys
    table.foreign(['tenant', 'execution_id']).references(['tenant', 'execution_id']).inTable('workflow_executions');
    
    // Create index for efficient sync point retrieval
    table.index(['tenant', 'execution_id', 'status']);
  });

  // Create workflow_timers table to track active timers for workflow instances
  await knex.schema.createTable('workflow_timers', (table) => {
    table.uuid('timer_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.uuid('execution_id').notNullable();
    table.text('timer_name').notNullable();
    table.text('state_name').notNullable();
    table.timestamp('start_time', { useTz: true }).notNullable();
    table.specificType('duration', 'INTERVAL').notNullable();
    table.timestamp('fire_time', { useTz: true }).notNullable();
    table.text('recurrence');
    table.text('status').notNullable().defaultTo('active');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Foreign keys
    table.foreign(['tenant', 'execution_id']).references(['tenant', 'execution_id']).inTable('workflow_executions');
    
    // Create index for efficient timer retrieval and processing
    table.index(['tenant', 'status', 'fire_time']);
  });
};

exports.down = async function(knex) {
  // Drop tables in reverse order to avoid foreign key constraints
  await knex.schema.dropTableIfExists('workflow_timers');
  await knex.schema.dropTableIfExists('workflow_sync_points');
  await knex.schema.dropTableIfExists('workflow_action_dependencies');
  await knex.schema.dropTableIfExists('workflow_action_results');
};
