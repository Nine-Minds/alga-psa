'use strict';

/** @type {import('knex').Knex.Migration} */
exports.up = async function(knex) {
  await knex.schema.alterTable('workflow_task_definitions', function(table) {
    // Add the task_type column.
    // It's set to NOT NULL. If there's existing data, you might need to provide a default
    // or allow NULL initially and then populate it. For a new setup or if the table is empty,
    // NOT NULL is fine. Given the error, it's likely this is a missing piece from an intended schema.
    table.text('task_type').notNullable();

    // Add an index for tenant and task_type for query performance.
    table.index(['tenant', 'task_type'], 'idx_workflow_task_definitions_tenant_task_type');
  });
};

/** @type {import('knex').Knex.Migration} */
exports.down = async function(knex) {
  await knex.schema.alterTable('workflow_task_definitions', function(table) {
    table.dropIndex(['tenant', 'task_type'], 'idx_workflow_task_definitions_tenant_task_type');
    table.dropColumn('task_type');
  });
};