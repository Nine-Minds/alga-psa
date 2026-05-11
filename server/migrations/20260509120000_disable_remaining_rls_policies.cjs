/**
 * Disable any RLS policies that remain after the Citus migration.
 *
 * The app no longer sets app.current_tenant on pooled tenant connections. Any
 * table that still has an old RLS policy using that GUC can fail at read time
 * with "unrecognized configuration parameter app.current_tenant". Keep this
 * migration dynamic so newly discovered leftovers are cleared in hosted
 * environments without needing a table-by-table patch.
 *
 * Known drift this catches:
 * - EE AI tables from 202410291100_create_ai_schema.cjs: vectors, chats, messages
 * - ticket_entity_links in environments where an older table/policy state exists
 */

// Citus rejects ALTER TABLE ... DISABLE ROW LEVEL SECURITY on distributed
// tables when wrapped in a migration transaction.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  const result = await knex.raw(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = true
    ORDER BY tablename
  `);

  for (const row of result.rows) {
    const tableName = row.tablename;

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
  throw new Error('This migration cannot be rolled back - RLS policies are disabled for CitusDB compatibility');
};
