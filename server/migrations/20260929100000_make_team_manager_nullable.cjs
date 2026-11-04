/**
 * alga-2026-0002379 — a team lead may be "Not Assigned".
 *
 * The team settings UI (and the ITeam type, and every reader of teams.manager_id)
 * treat the lead as optional, but the column was NOT NULL, so choosing
 * "Not Assigned" could never be saved. The (tenant, manager_id) -> users FK stays;
 * with MATCH SIMPLE a NULL manager_id is simply unconstrained.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE teams ALTER COLUMN manager_id DROP NOT NULL');
};

/**
 * Restoring NOT NULL needs a lead for every team. Teams without one get their
 * earliest-added member; a team with no members at all cannot be restored, so
 * the rollback stops with a clear message rather than inventing a lead.
 */
exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE teams t
       SET manager_id = (
         SELECT tm.user_id
           FROM team_members tm
          WHERE tm.tenant = t.tenant AND tm.team_id = t.team_id
          ORDER BY (tm.role = 'lead') DESC, tm.created_at ASC, tm.user_id ASC
          LIMIT 1)
     WHERE t.manager_id IS NULL
  `);
  const { rows } = await knex.raw('SELECT count(*)::int AS n FROM teams WHERE manager_id IS NULL');
  if (rows[0].n > 0) {
    throw new Error(
      `Cannot restore NOT NULL on teams.manager_id: ${rows[0].n} team(s) have no lead and no members. ` +
      'Add a member or delete those teams first.'
    );
  }
  await knex.raw('ALTER TABLE teams ALTER COLUMN manager_id SET NOT NULL');
};
