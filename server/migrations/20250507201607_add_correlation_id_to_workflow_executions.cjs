'use strict';

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('workflow_executions', function(table) {
    table.string('correlation_id').nullable();
    // Add an index for faster lookups if correlation_id will be queried often
    table.index(['tenant', 'workflow_name', 'correlation_id'], 'idx_workflow_executions_correlation');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('workflow_executions', function(table) {
    // It's good practice to drop indexes before dropping columns
    table.dropIndex(['tenant', 'workflow_name', 'correlation_id'], 'idx_workflow_executions_correlation');
    table.dropColumn('correlation_id');
  });
};
