/**
 * Backfill multi-approver arrays on availability_settings.config_json.
 *
 * Appointment approvers used to be a single `default_approver_id` value. They now support
 * multiple users (`approver_user_ids`) plus teams (`approver_team_ids`). This migration
 * seeds the new arrays from the legacy single value so existing configurations keep working.
 *
 * The legacy `default_approver_id` is intentionally left in place as a fallback.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const rows = await knex('availability_settings')
    .whereNotNull('config_json')
    .whereRaw("config_json ->> 'default_approver_id' IS NOT NULL")
    .whereRaw("(config_json -> 'approver_user_ids') IS NULL")
    .select('availability_setting_id', 'tenant', 'config_json');

  for (const row of rows) {
    const config = row.config_json || {};
    const legacyId = config.default_approver_id;
    if (!legacyId) continue;

    config.approver_user_ids = [legacyId];
    if (!Array.isArray(config.approver_team_ids)) {
      config.approver_team_ids = [];
    }

    await knex('availability_settings')
      .where({ availability_setting_id: row.availability_setting_id, tenant: row.tenant })
      .update({ config_json: config, updated_at: new Date() });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const rows = await knex('availability_settings')
    .whereNotNull('config_json')
    .whereRaw("config_json ->> 'default_approver_id' IS NOT NULL")
    .whereRaw("(config_json -> 'approver_user_ids') IS NOT NULL")
    .select('availability_setting_id', 'tenant', 'config_json');

  for (const row of rows) {
    const config = row.config_json || {};
    const legacyId = config.default_approver_id;
    const userIds = Array.isArray(config.approver_user_ids) ? config.approver_user_ids : [];
    const teamIds = Array.isArray(config.approver_team_ids) ? config.approver_team_ids : [];

    // Only revert rows that still match the exact shape this migration produced
    // (a single approver equal to the legacy id, and no teams). Anything edited via
    // the settings UI since the backfill is user-authored config and must be left
    // intact — the UI drops `default_approver_id` on save, so re-saved rows won't match.
    const isUntouchedBackfill =
      legacyId &&
      userIds.length === 1 &&
      userIds[0] === legacyId &&
      teamIds.length === 0;

    if (!isUntouchedBackfill) continue;

    delete config.approver_user_ids;
    delete config.approver_team_ids;

    await knex('availability_settings')
      .where({ availability_setting_id: row.availability_setting_id, tenant: row.tenant })
      .update({ config_json: config, updated_at: new Date() });
  }
};
