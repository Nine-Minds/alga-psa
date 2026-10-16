'use strict';

/**
 * Drop the RLS policies that 20260825130000_create_amp_migration_tables.cjs
 * (and 20260822233548_add_asset_maintenance_occurrences.cjs) re-introduced
 * after 20260509120000_disable_remaining_rls_policies.cjs had cleared RLS
 * schema-wide.
 *
 * The policies key on current_setting('app.current_tenant'), which the app no
 * longer sets (tenant scoping is explicit `tenant` columns plus Citus
 * distribution). On hosted, every POST /api/migrations/upload failed with
 * "new row violates row-level security policy for table migration_jobs"
 * (GitHub issue #3741), and the migration_jobs SELECT policy hid every row
 * from app_user. CI never saw it because the test harness grants the table
 * owner role to app_user, which bypasses RLS.
 *
 * Dynamic like the 20260509 migration: clears any table in public that still
 * carries RLS from these two migrations, so hosted and self-host converge
 * without a table-by-table patch.
 */

// Citus rejects ALTER TABLE ... DISABLE ROW LEVEL SECURITY on distributed
// tables when wrapped in a migration transaction.
exports.config = { transaction: false };

const TABLES = [
  'migration_jobs',
  'migration_job_entities',
  'migration_staged_records',
  'migration_record_outcomes',
  'migration_identity_mappings',
  'migration_mapping_profiles',
  'migration_reports',
  'asset_maintenance_occurrences',
];

exports.up = async function up(knex) {
  for (const tableName of TABLES) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) continue;

    const policies = await knex.raw(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ?`,
      [tableName]
    );
    for (const policy of policies.rows) {
      await knex.raw(`DROP POLICY IF EXISTS "${policy.policyname}" ON "${tableName}"`);
    }

    await knex.raw(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY`);
  }
};

exports.down = function down() {
  throw new Error('This migration cannot be rolled back - RLS policies are disabled for CitusDB compatibility');
};
