/**
 * Disable RLS on the credentials vault tables.
 *
 * The app connects as a non-superuser through pooled connections where the
 * `app.current_tenant` GUC may be unset — an RLS policy reading that GUC
 * fails at read/write time with "unrecognized configuration parameter". The
 * repo standard (20260509120000_disable_remaining_rls_policies.cjs) dropped
 * RLS repo-wide for exactly this reason; tenant isolation is enforced at the
 * query layer via the tenantDb facade (see architecture/tenant-isolation.md).
 *
 * The credential create migration originally enabled RLS; this follow-up
 * removes it for environments that already applied that version (and is a
 * no-op for fresh installs that run the corrected create migration). Mirrors
 * 20260107180000_disable_rls_on_post_citus_tables.cjs.
 */

// Citus rejects ALTER TABLE ... DISABLE ROW LEVEL SECURITY on distributed
// tables when wrapped in a migration transaction.
exports.config = { transaction: false };

const TABLES = ['credentials', 'credential_associations', 'credential_access_grants'];

exports.up = async function up(knex) {
  for (const tableName of TABLES) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
      continue;
    }

    const policies = await knex.raw(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ?
    `, [tableName]);

    for (const policy of policies.rows) {
      await knex.raw(`DROP POLICY IF EXISTS "${policy.policyname}" ON "${tableName}"`);
    }

    await knex.raw(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY`);
  }
};

exports.down = function down() {
  throw new Error('This migration cannot be rolled back - RLS is intentionally not re-added for CitusDB compatibility');
};
