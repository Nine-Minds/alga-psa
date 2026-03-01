/**
 * Set role='lead' for team members who match team manager.
 */
exports.up = async function up(knex) {
  const hasRole = await knex.schema.hasColumn('team_members', 'role');
  if (!hasRole) {
    return;
  }

  await knex.raw(`
    UPDATE team_members tm
    SET role = 'lead'
    FROM teams t
    WHERE tm.team_id = t.team_id
      AND tm.tenant = t.tenant
      AND tm.user_id = t.manager_id
  `);
};

exports.down = async function down() {
  // Data migration: no-op.
};
