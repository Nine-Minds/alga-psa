/**
 * Collapse ambiguous availability scopes and prevent them from recurring.
 * The newest row wins deterministically, with IDs breaking timestamp ties.
 *
 * Runs untransacted: availability_settings is distributed on `tenant`, and
 * Citus refuses DDL on a distributed table that was already modified in the
 * same transaction. Every statement is idempotent (the deletes only ever
 * remove losing duplicates, the indexes are IF NOT EXISTS), so a partial run
 * is safe to repeat. Matches the sibling dedupe-then-guard migrations
 * 20260831090000_unique_pending_accounting_sync_operations and
 * 20260903160000_unique_active_online_meeting_per_schedule_entry.
 */

exports.up = async function up(knex) {
  await knex.raw(`
    WITH ranked AS (
      SELECT tenant, availability_setting_id,
        row_number() OVER (
          PARTITION BY tenant, user_id, day_of_week
          ORDER BY updated_at DESC, created_at DESC, availability_setting_id DESC
        ) AS scope_rank
      FROM availability_settings
      WHERE setting_type = 'user_hours' AND user_id IS NOT NULL AND day_of_week IS NOT NULL
    )
    DELETE FROM availability_settings duplicate
    USING ranked
    WHERE duplicate.tenant = ranked.tenant
      AND duplicate.availability_setting_id = ranked.availability_setting_id
      AND ranked.scope_rank > 1
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT tenant, availability_setting_id,
        row_number() OVER (
          PARTITION BY tenant, service_id
          ORDER BY updated_at DESC, created_at DESC, availability_setting_id DESC
        ) AS scope_rank
      FROM availability_settings
      WHERE setting_type = 'service_rules' AND service_id IS NOT NULL
    )
    DELETE FROM availability_settings duplicate
    USING ranked
    WHERE duplicate.tenant = ranked.tenant
      AND duplicate.availability_setting_id = ranked.availability_setting_id
      AND ranked.scope_rank > 1
  `);

  await knex.raw(`
    WITH ranked AS (
      SELECT tenant, availability_setting_id,
        row_number() OVER (
          PARTITION BY tenant
          ORDER BY updated_at DESC, created_at DESC, availability_setting_id DESC
        ) AS scope_rank
      FROM availability_settings
      WHERE setting_type = 'general_settings'
    )
    DELETE FROM availability_settings duplicate
    USING ranked
    WHERE duplicate.tenant = ranked.tenant
      AND duplicate.availability_setting_id = ranked.availability_setting_id
      AND ranked.scope_rank > 1
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS availability_settings_user_day_unique
    ON availability_settings (tenant, user_id, day_of_week)
    WHERE setting_type = 'user_hours' AND user_id IS NOT NULL AND day_of_week IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS availability_settings_service_unique
    ON availability_settings (tenant, service_id)
    WHERE setting_type = 'service_rules' AND service_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS availability_settings_general_unique
    ON availability_settings (tenant)
    WHERE setting_type = 'general_settings'
  `);
};

exports.down = async function down(knex) {
  // Collapsed duplicates are not resurrected — their removal is a fact.
  await knex.raw('DROP INDEX IF EXISTS availability_settings_user_day_unique');
  await knex.raw('DROP INDEX IF EXISTS availability_settings_service_unique');
  await knex.raw('DROP INDEX IF EXISTS availability_settings_general_unique');
};

exports.config = { transaction: false };
