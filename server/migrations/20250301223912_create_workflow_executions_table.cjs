exports.up = async function(knex) {
  // Create the workflow_executions table with minimal fields
  // State is derived from events in the event-sourced architecture
  await knex.schema.createTable('workflow_executions', (table) => {
    table.uuid('execution_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant').notNullable();
    table.text('workflow_name').notNullable();
    table.text('workflow_version').notNullable().defaultTo('latest');
    table.text('current_state').notNullable();
    table.text('status').notNullable().defaultTo('active');
    table.jsonb('context_data');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    
    // Create unique index including tenant for CitusDB compatibility
    table.unique(['tenant', 'execution_id']);
  });
};

exports.down = async function(knex) {
  // Drop the workflow_executions table
  await knex.schema.dropTableIfExists('workflow_executions');
};
