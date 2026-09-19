/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('workflow_tasks', function(table) {
    // Add is_hidden column to support hiding tasks from user
    table.boolean('is_hidden').defaultTo(false).notNullable();
    
    // Add hidden_at timestamp to track when task was hidden
    table.timestamp('hidden_at').nullable();
    
    // Add hidden_by user id to track who hid the task
    table.uuid('hidden_by').nullable();
  })
  .then(() => {
    // Add index for efficient querying of non-hidden tasks
    return knex.schema.alterTable('workflow_tasks', function(table) {
      table.index(['tenant', 'is_hidden'], 'idx_workflow_tasks_tenant_hidden');
      table.index(['tenant', 'is_hidden', 'status'], 'idx_workflow_tasks_tenant_hidden_status');
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('workflow_tasks', function(table) {
    // Drop indexes first
    table.dropIndex([], 'idx_workflow_tasks_tenant_hidden');
    table.dropIndex([], 'idx_workflow_tasks_tenant_hidden_status');
    
    // Drop columns
    table.dropColumn('is_hidden');
    table.dropColumn('hidden_at');
    table.dropColumn('hidden_by');
  });
};