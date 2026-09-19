/**
 * Migration to create workflow task inbox tables
 */
exports.up = async function(knex) {
  // Create workflow_task_definitions table
  await knex.schema.createTable('workflow_task_definitions', (table) => {
    table.string('task_definition_id').primary();
    table.string('tenant').notNullable();
    table.string('task_type', 100).notNullable();
    table.string('name').notNullable();
    table.text('description');
    table.string('form_id').notNullable();
    table.string('default_priority', 50).defaultTo('medium');
    table.integer('default_sla_days').defaultTo(3);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    
    // Add unique constraint for tenant and task_type
    table.unique(['tenant', 'task_type']);
    
    // Add foreign key to form_definitions
    table.foreign('form_id').references('form_id').inTable('workflow_form_definitions');
  });

  // Create workflow_tasks table
  await knex.schema.createTable('workflow_tasks', (table) => {
    table.string('task_id').primary();
    table.string('tenant').notNullable();
    table.string('execution_id').notNullable();
    table.string('event_id');
    table.string('task_definition_id').notNullable();
    table.string('title').notNullable();
    table.text('description');
    table.string('status', 50).notNullable().defaultTo('pending');
    table.string('priority', 50).notNullable().defaultTo('medium');
    table.timestamp('due_date');
    table.jsonb('context_data');
    table.jsonb('assigned_roles');
    table.jsonb('assigned_users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.string('created_by');
    table.timestamp('claimed_at');
    table.string('claimed_by');
    table.timestamp('completed_at');
    table.string('completed_by');
    table.jsonb('response_data');
    
    // Add foreign key to task_definitions
    table.foreign('task_definition_id').references('task_definition_id').inTable('workflow_task_definitions');
    
    // Add indexes for common queries
    table.index(['tenant', 'status']);
    table.index(['tenant', 'execution_id']);
    table.index(['tenant', 'due_date']);
  });

  // Create workflow_task_history table for audit trail
  await knex.schema.createTable('workflow_task_history', (table) => {
    table.string('history_id').primary();
    table.string('task_id').notNullable();
    table.string('tenant').notNullable();
    table.string('action', 50).notNullable();
    table.string('from_status', 50);
    table.string('to_status', 50);
    table.string('user_id');
    table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
    table.jsonb('details');
    
    // Add foreign key to tasks
    table.foreign('task_id').references('task_id').inTable('workflow_tasks').onDelete('CASCADE');
    
    // Add index for task_id
    table.index(['tenant', 'task_id']);
  });
};

exports.down = async function(knex) {
  // Drop tables in reverse order to handle foreign key constraints
  await knex.schema.dropTableIfExists('workflow_task_history');
  await knex.schema.dropTableIfExists('workflow_tasks');
  await knex.schema.dropTableIfExists('workflow_task_definitions');
};
