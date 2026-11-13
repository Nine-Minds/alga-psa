'use strict';
const { distributeLocalTenantTables, hasCitus, isDistributed } = require('./utils/citusDistribution.cjs');

// The RMM tables were never distributed, so every query that joins them to
// tickets, assets or clients is a recursively planned subplan shipped over a
// loopback connection — alert ingest fails whenever the coordinator is near
// max_connections. Everything hangs off rmm_integrations by foreign key, so
// the family moves together; every key already carries tenant.

const COLOCATE_WITH = 'assets';

// Referenced tables first.
const TABLES = [
  'rmm_integrations',
  'rmm_organization_mappings',
  'rmm_alert_rules',
  'rmm_maintenance_windows',
  'rmm_alerts',
  'rmm_webhook_events',
  'rmm_condition_states',
  'rmm_condition_transitions',
  'unifi_credentials',
  'unifi_console_routes',
];

// on_update_timestamp() stamped updated_at for these; every writer now sets it.
const TIMESTAMP_TRIGGERS = {
  rmm_integrations: ['set_timestamp_rmm_integrations'],
  rmm_organization_mappings: ['set_timestamp_rmm_organization_mappings'],
  rmm_alert_rules: ['set_timestamp_rmm_alert_rules'],
  rmm_maintenance_windows: ['set_timestamp_rmm_maintenance_windows'],
  rmm_alerts: ['set_timestamp_rmm_alerts'],
};

// A local table's foreign key to a distributed parent is not enforced, so rows
// can point at assets and clients that were deleted since. On the shards the
// key is real and such a row would fail the move. Returns, per tenant, the
// referenced ids that no longer exist.
async function missingParents(knex, table, column, parent) {
  if (!(await knex.schema.hasTable(table)) || (await isDistributed(knex, table))) return [];

  const referenced = await knex.raw(
    'SELECT tenant, array_agg(DISTINCT ??) AS ids FROM ?? WHERE ?? IS NOT NULL GROUP BY tenant',
    [column, table, column],
  );
  const result = [];
  for (const { tenant, ids } of referenced.rows) {
    const found = await knex.raw('SELECT ?? AS id FROM ?? WHERE tenant = ? AND ?? = ANY(?::uuid[])', [
      column, parent, tenant, column, ids,
    ]);
    const live = new Set(found.rows.map((row) => row.id));
    const missing = ids.filter((id) => !live.has(id));
    if (missing.length > 0) result.push({ tenant, missing });
  }
  return result;
}

// Each orphan gets what its key's delete action would have done: alerts and
// organisation mappings lose the reference, maintenance windows go.
async function repairOrphans(knex) {
  for (const { tenant, missing } of await missingParents(knex, 'rmm_alerts', 'asset_id', 'assets')) {
    // migration-lint: allow 5 - bounded: one tenant per statement, only rows whose parent row no longer exists
    await knex.raw('UPDATE rmm_alerts SET asset_id = NULL WHERE tenant = ? AND asset_id = ANY(?::uuid[])', [tenant, missing]);
  }
  for (const { tenant, missing } of await missingParents(knex, 'rmm_organization_mappings', 'client_id', 'clients')) {
    // migration-lint: allow 5 - bounded: one tenant per statement, only rows whose parent row no longer exists
    await knex.raw('UPDATE rmm_organization_mappings SET client_id = NULL WHERE tenant = ? AND client_id = ANY(?::uuid[])', [tenant, missing]);
  }
  for (const { tenant, missing } of await missingParents(knex, 'rmm_maintenance_windows', 'asset_id', 'assets')) {
    // migration-lint: allow 5 - bounded: one tenant per statement, only rows whose parent row no longer exists
    await knex.raw('DELETE FROM rmm_maintenance_windows WHERE tenant = ? AND asset_id = ANY(?::uuid[])', [tenant, missing]);
  }
  for (const { tenant, missing } of await missingParents(knex, 'rmm_maintenance_windows', 'client_id', 'clients')) {
    // migration-lint: allow 5 - bounded: one tenant per statement, only rows whose parent row no longer exists
    await knex.raw('DELETE FROM rmm_maintenance_windows WHERE tenant = ? AND client_id = ANY(?::uuid[])', [tenant, missing]);
  }
}

exports.up = async function up(knex) {
  if (!(await hasCitus(knex))) return;
  if (!(await isDistributed(knex, COLOCATE_WITH))) return;

  await repairOrphans(knex);

  await distributeLocalTenantTables(knex, {
    tables: TABLES,
    colocateWith: COLOCATE_WITH,
    dropTriggers: TIMESTAMP_TRIGGERS,
  });
};

// Forward-only: undistribute_table() would have to cascade through assets.
exports.down = async function down(_knex) {};

// create_distributed_table() must not run inside the migration batch transaction.
exports.config = { transaction: false };
