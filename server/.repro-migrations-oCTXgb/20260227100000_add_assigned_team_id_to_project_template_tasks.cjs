/**
 * Add assigned_team_id column to project_template_tasks.
 */
exports.up = async function up(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('project_template_tasks', 'assigned_team_id');
  if (!hasAssignedTeam) {
    await knex.schema.alterTable('project_template_tasks', (table) => {
      table.uuid('assigned_team_id').nullable();
      table.foreign(['tenant', 'assigned_team_id']).references(['tenant', 'team_id']).inTable('teams');
    });
  }
};

exports.down = async function down(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('project_template_tasks', 'assigned_team_id');
  if (!hasAssignedTeam) {
    return;
  }

  await knex.schema.alterTable('project_template_tasks', (table) => {
    table.dropColumn('assigned_team_id');
  });
};
