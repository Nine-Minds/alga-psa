/**
 * Migration: hudu_integrations sync-state columns (EE-only).
 *
 * Adds the RMM-consistent connection-level sync status columns the tenant-wide
 * import/auto-sync feature reports on (mirrors rmm_integrations.sync_status /
 * sync_error). The auto-sync toggle and last-run summary live in the existing
 * `settings` jsonb (like password_access / companies_cache), so only status
 * columns are added here.
 *
 * ADD COLUMN propagates to shards automatically on a distributed Citus table,
 * so no create_distributed_table dance is needed. Idempotent via hasColumn.
 */

const TABLE = 'hudu_integrations';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    // hudu_integrations is created by 20260609120000; if it isn't here yet this
    // migration is a no-op and the base migration will create the full shape.
    return;
  }

  const hasSyncStatus = await knex.schema.hasColumn(TABLE, 'sync_status');
  const hasSyncError = await knex.schema.hasColumn(TABLE, 'sync_error');
  const hasLastFullSyncAt = await knex.schema.hasColumn(TABLE, 'last_full_sync_at');

  if (hasSyncStatus && hasSyncError && hasLastFullSyncAt) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    if (!hasSyncStatus) {
      // idle | syncing | completed | error
      table.text('sync_status').notNullable().defaultTo('idle');
    }
    if (!hasSyncError) {
      table.text('sync_error');
    }
    if (!hasLastFullSyncAt) {
      // Timestamp of the last tenant-wide import/sync run. The existing
      // last_synced_at stays scoped to the company-cache sync.
      table.timestamp('last_full_sync_at', { useTz: true });
    }
  });
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    return;
  }

  await knex.schema.alterTable(TABLE, (table) => {
    table.dropColumn('sync_status');
    table.dropColumn('sync_error');
    table.dropColumn('last_full_sync_at');
  });
};

exports.config = { transaction: false };
