/**
 * Disable RLS on the asset maintenance tables.
 *
 * Tenant isolation is enforced by tenant-scoped queries. RLS is incompatible
 * with the pooled application connections because app.current_tenant is not
 * guaranteed to be set. In Citus, violations are reported against the physical
 * shard table (for example asset_maintenance_occurrences_<shard_id>), but the
 * policy must be removed from the logical distributed table.
 */

// Citus rejects ALTER TABLE ... DISABLE ROW LEVEL SECURITY on distributed
// tables when wrapped in a migration transaction.
exports.config = { transaction: false };

const TABLES = [
  'asset_maintenance_occurrences',
  'asset_maintenance_schedules',
  'asset_maintenance_notifications',
  'asset_maintenance_history',
];

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
  throw new Error('This migration cannot be rolled back - RLS is intentionally disabled for CitusDB compatibility');
};
