'use strict';

/** @type {import('knex').Knex.Migration} */
exports.up = async function(knex) {
  await knex.schema.alterTable('workflow_tasks', function(table) {
    table.uuid('completed_by').nullable().comment('ID of the user who completed the task');
    // Add foreign key constraint to users table
    // Note: The users table has a composite unique key (tenant, user_id)
    // We need to ensure our foreign key references this composite key.
    // Knex syntax for composite foreign keys: table.foreign(['tenant', 'completed_by']).references(['tenant', 'user_id']).inTable('users');
    // However, 'tenant' column already exists in workflow_tasks.
    // We are adding 'completed_by' which will store the user_id.
    table.foreign(['tenant', 'completed_by'])
      .references(['tenant', 'user_id'])
      .inTable('users')
      // onDelete('SET NULL')  This logic will be handled in application code instead
  });
};

/** @type {import('knex').Knex.Migration} */
exports.down = async function(knex) {
  // The alterTable callback itself is synchronous.
  // Operations on the 'table' object configure the alteration.
  // The 'await' applies to the entire alterTable operation.
  await knex.schema.alterTable('workflow_tasks', function(table) {
    // Drop the foreign key constraint first.
    // Knex handles the order of operations within the alterTable block.
    table.dropForeign(['tenant', 'completed_by']);
    table.dropColumn('completed_by');
  });
};
