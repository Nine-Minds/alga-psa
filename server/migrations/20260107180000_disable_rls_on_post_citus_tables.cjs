/**
 * Disable RLS on tables that were created after the CitusDB migration.
 *
 * Several tables were created after 20250523152638_remove_rls_policies_for_citusdb
 * and incorrectly added RLS policies. With CitusDB, tenant isolation is handled
 * at the shard level, so RLS is not needed and causes errors since the
 * app.current_tenant configuration parameter is not set on connections.
 *
 * Tables affected:
 * - 20250627123000: tenant_telemetry_settings, telemetry_consent_log
 * - 20251102090000: import_sources, import_jobs, import_job_items, external_entity_mappings
 * - 20251124120000: external_tax_imports
 */

// Disable implicit transaction - Citus rejects ALTER TABLE ... DISABLE ROW LEVEL SECURITY
// and DROP POLICY on distributed tables when wrapped in a transaction.
exports.config = { transaction: false };

const TABLES = [
  // From 20250627123000_add_telemetry_settings.cjs
  'tenant_telemetry_settings',
  'telemetry_consent_log',
  // From 20251102090000_create_import_framework_tables.cjs
  'import_sources',
  'import_jobs',
  'import_job_items',
  'external_entity_mappings',
  // From 20251124120000_add_external_tax_support.cjs
  'external_tax_imports',
];

exports.up = async function up(knex) {
  console.log('Disabling RLS on tables created after CitusDB migration...');

  for (const tableName of TABLES) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
      console.log(`  Table ${tableName} does not exist, skipping`);
      continue;
    }

    // Get all policies for this table
    const policies = await knex.raw(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ?
    `, [tableName]);

    // Drop all policies for this table
    for (const policy of policies.rows) {
      console.log(`  Dropping policy ${policy.policyname} on ${tableName}`);
      await knex.raw(`DROP POLICY IF EXISTS "${policy.policyname}" ON "${tableName}"`);
    }

    // Disable RLS for this table
    await knex.raw(`ALTER TABLE "${tableName}" DISABLE ROW LEVEL SECURITY`);
    console.log(`  Disabled RLS on ${tableName}`);
  }

  console.log('RLS disabled on all post-CitusDB tables');
};

exports.down = function down(knex) {
  // This migration is intended to be irreversible for CitusDB compatibility
  throw new Error('This migration cannot be rolled back - RLS policies have been permanently removed for CitusDB compatibility');
};
