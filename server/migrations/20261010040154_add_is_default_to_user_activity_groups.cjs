/**
 * Add `is_default` to user_activity_groups.
 *
 * A user can flag one of their groups as the default: activities with no explicit group
 * membership render in that group instead of "Ungrouped" (applied at view time; nothing is
 * written at assignment time). The partial unique index enforces "at most one default per
 * user". It includes `tenant`, the Citus distribution column, so it is valid on the
 * distributed table. No backfill: existing rows default to false.
 *
 * DEPLOY ORDER: apply this migration BEFORE deploying code that selects `is_default`
 * (e.g. getUserActivityGroupsForApi); those queries throw on an unmigrated database.
 * It is idempotent (IF NOT EXISTS / IF EXISTS), so it is safe to run twice. Shared dev
 * databases that `knex migrate:up` refuses to touch need the manual-apply recipe in section 9 of
 * docs/plans/2026-10-10-default-user-activities-group-assigned-work-plan.md.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.raw(`
    ALTER TABLE user_activity_groups
    ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false
  `);

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_groups_one_default
    ON user_activity_groups (tenant, user_id)
    WHERE is_default
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_user_activity_groups_one_default');
  await knex.schema.raw('ALTER TABLE user_activity_groups DROP COLUMN IF EXISTS is_default');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
