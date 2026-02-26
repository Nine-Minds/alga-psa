/**
 * Add assigned_team_id column to project_tasks.
 */
exports.up = async function up(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('project_tasks', 'assigned_team_id');
  if (!hasAssignedTeam) {
    await knex.schema.alterTable('project_tasks', (table) => {
      table.uuid('assigned_team_id').nullable().references('team_id').inTable('teams');
    });
  }
};

exports.down = async function down(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('project_tasks', 'assigned_team_id');
  if (!hasAssignedTeam) {
    return;
  }

  await knex.schema.alterTable('project_tasks', (table) => {
    table.dropColumn('assigned_team_id');
  });
};
