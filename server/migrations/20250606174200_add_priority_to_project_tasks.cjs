exports.up = async function(knex) {
  // Add priority_id column to project_tasks table
  await knex.schema.alterTable('project_tasks', (table) => {
    table.uuid('priority_id').nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('project_tasks', (table) => {
    // No foreign key to drop since we didn't create one
    table.dropColumn('priority_id');
  });
};