/**
 * alga-2026-0002912 — teams need a free-text description.
 *
 * `team_name` alone cannot say what a team is for, so pickers and the team
 * settings page have no room for scope/purpose. TeamService.searchTeams already
 * searched `teams.description`, which simply could not match before this column
 * existed. Additive and idempotent; no backfill (existing teams stay NULL).
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE teams ADD COLUMN IF NOT EXISTS description text');
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE teams DROP COLUMN IF EXISTS description');
};
