/**
 * Index appointment-approver arrays on availability_settings.config_json.
 *
 * The appointment-request list query asks "is this user an approver?" by scanning every
 * general_settings + user_hours row in the tenant and parsing the JSONB. These GIN
 * expression indexes let PostgreSQL evaluate the `?` and `?|` membership tests against
 * the extracted arrays directly, so the planner can index-prune the scan.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_availability_settings_approver_user_ids
    ON availability_settings USING gin ((config_json -> 'approver_user_ids'))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_availability_settings_approver_team_ids
    ON availability_settings USING gin ((config_json -> 'approver_team_ids'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_availability_settings_approver_user_ids');
  await knex.raw('DROP INDEX IF EXISTS idx_availability_settings_approver_team_ids');
};
