'use strict';
const { distributeLocalTenantTables } = require('./utils/citusDistribution.cjs');

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

exports.up = async function up(knex) {
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
