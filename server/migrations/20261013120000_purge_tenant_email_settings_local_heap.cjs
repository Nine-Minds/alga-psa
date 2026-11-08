/**
 * Purge the coordinator-local heap of tenant_email_settings on Citus.
 *
 * create_distributed_table() leaves the pre-distribution rows on disk in the
 * logical parent table ("no longer visible, but still on disk"). For this table
 * those leftovers can include plaintext SMTP passwords / Resend API keys from
 * provider_configs. No application UPDATE can reach them, so truncate them here.
 *
 * - No-op on plain Postgres (CE) and when the table is not distributed.
 * - Only removes the invisible local parent-heap rows; shard data is untouched.
 * - Cascades to local heaps of tables with foreign keys to this table (checked:
 *   there are none locally; any would be stale leftovers too).
 * - Does not touch the secret store; the plaintext -> secret move is done by
 *   server/scripts/backfill-tenant-email-secrets.ts.
 */
exports.up = async function up(knex) {
  const citusInstalled = await knex.raw(
    "SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus"
  );
  if (!citusInstalled.rows[0].has_citus) return;

  const tableExists = await knex.raw(
    "SELECT to_regclass('public.tenant_email_settings') IS NOT NULL AS present"
  );
  if (!tableExists.rows[0].present) return;

  const distributed = await knex.raw(
    "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.tenant_email_settings'::regclass"
  );
  if (distributed.rows.length === 0) return;

  await knex.raw(
    "SELECT truncate_local_data_after_distributing_table('public.tenant_email_settings')"
  );
};

exports.down = async function down(_knex) {
  // Purged local-heap rows are invisible stale copies and cannot be restored.
};
