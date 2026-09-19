/**
 * Seed reports_to from existing team membership data.
 */
exports.up = async function up(knex) {
  const hasReportsTo = await knex.schema.hasColumn('users', 'reports_to');
  if (!hasReportsTo) {
    return;
  }

  await knex.raw(`
    UPDATE users u
    SET reports_to = t.manager_id
    FROM team_members tm
    JOIN teams t ON t.team_id = tm.team_id AND t.tenant = tm.tenant
    WHERE u.user_id = tm.user_id
      AND u.tenant = tm.tenant
      AND u.user_id != t.manager_id
      AND u.reports_to IS NULL
      AND t.manager_id IS NOT NULL
  `);
};

exports.down = async function down() {
  // Data migration: no-op.
};
