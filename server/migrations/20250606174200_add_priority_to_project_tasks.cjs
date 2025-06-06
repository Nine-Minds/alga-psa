exports.up = async function(knex) {
  // Add priority_id column to project_tasks table
  await knex.schema.alterTable('project_tasks', (table) => {
    table.uuid('priority_id').nullable();
    
    // Add foreign key constraint
    table.foreign(['tenant', 'priority_id'])
      .references(['tenant', 'priority_id'])
      .inTable('priorities');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('project_tasks', (table) => {
    table.dropForeign(['tenant', 'priority_id']);
    table.dropColumn('priority_id');
  });
};